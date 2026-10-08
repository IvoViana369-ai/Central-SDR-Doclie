import 'server-only';
import {
  isDomainError,
  resolveActor,
  UnauthenticatedError,
  ValidationError,
  type Actor,
  type CoreDeps,
  type Logger,
  type RequestMeta,
} from '@docline/core';
import { getAuth } from './auth';
import { getContainer } from './container';
import { ipAddressOptions, requestMetaFrom } from './request-meta';

const MAX_BODY_BYTES = 1_000_000;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ApiContext<P> {
  request: Request;
  actor: Actor;
  meta: RequestMeta;
  deps: CoreDeps;
  params: P;
  /** Lê o corpo JSON (limite de 1 MB); corpo inválido vira erro 422. */
  body(): Promise<unknown>;
  /** Parâmetros de consulta como objeto simples. */
  query(): Record<string, string>;
}

interface ApiOptions {
  /** 'required' (padrão): exige sessão válida. 'public': sem sessão. */
  auth?: 'required' | 'public';
  /** Status HTTP de sucesso (padrão 200). */
  status?: number;
}

class OriginError extends Error {}

const TITLES: Record<string, string> = {
  VALIDATION_FAILED: 'Dados inválidos',
  UNAUTHENTICATED: 'Não autenticado',
  FORBIDDEN: 'Acesso negado',
  NOT_FOUND: 'Não encontrado',
  CONFLICT: 'Conflito',
  BUSINESS_RULE: 'Regra de negócio',
};

function problem(
  status: number,
  code: string,
  detail: string,
  requestId?: string,
  extra: object = {},
) {
  return Response.json(
    {
      type: 'about:blank',
      title: TITLES[code] ?? 'Erro',
      status,
      code,
      detail,
      requestId,
      ...extra,
    },
    {
      status,
      headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
    },
  );
}

/** Proteção CSRF: requisições que alteram estado precisam vir da própria aplicação. */
function assertSameOrigin(request: Request, appUrl: string, appEnv: string) {
  const origin = request.headers.get('origin');
  const allowed = new Set([new URL(appUrl).origin]);
  if (appEnv === 'development' || appEnv === 'test') {
    const host = request.headers.get('host');
    if (host) allowed.add(`${new URL(request.url).protocol}//${host}`);
  }
  if (!origin || !allowed.has(origin)) throw new OriginError();
}

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) {
    throw new ValidationError([{ path: '', message: 'Corpo da requisição muito grande.' }]);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new ValidationError([{ path: '', message: 'Corpo da requisição muito grande.' }]);
  }
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError([{ path: '', message: 'JSON inválido.' }]);
  }
}

function toProblem(error: unknown, meta: RequestMeta, logger: Logger): Response {
  if (error instanceof OriginError) {
    return problem(403, 'FORBIDDEN', 'Origem da requisição não permitida.', meta.requestId);
  }
  if (isDomainError(error)) {
    const extra = error instanceof ValidationError ? { errors: error.issues } : {};
    if (error.status >= 500)
      logger.error({ err: error, requestId: meta.requestId }, 'Erro de domínio');
    return problem(error.status, error.code, error.message, meta.requestId, extra);
  }
  logger.error({ err: error, requestId: meta.requestId }, 'Erro inesperado na API');
  return problem(
    500,
    'INTERNAL',
    `Erro interno. Informe o código ${meta.requestId} ao suporte.`,
    meta.requestId,
  );
}

/** Envolve um route handler da API v1 (docs/ARCHITECTURE.md §9.1). */
export function apiHandler<P extends Record<string, string> = Record<string, never>>(
  handler: (ctx: ApiContext<P>) => Promise<unknown>,
  options: ApiOptions = {},
) {
  return async (request: Request, context?: { params?: Promise<P> }): Promise<Response> => {
    const { deps, logger, env } = getContainer();
    const meta = requestMetaFrom(request.headers, ipAddressOptions(env.TRUSTED_PROXIES));
    try {
      if (MUTATING.has(request.method)) assertSameOrigin(request, env.APP_URL, env.APP_ENV);

      let actor: Actor = { kind: 'anonymous' };
      if (options.auth !== 'public') {
        const session = await getAuth().api.getSession({ headers: request.headers });
        if (!session) throw new UnauthenticatedError();
        const resolved = await resolveActor(deps.db, session.user.id);
        if (!resolved) throw new UnauthenticatedError();
        actor = resolved;
      }

      const params = ((await context?.params) ?? {}) as P;
      const result = await handler({
        request,
        actor,
        meta,
        deps,
        params,
        body: () => readJson(request),
        query: () => Object.fromEntries(new URL(request.url).searchParams),
      });
      if (result instanceof Response) return result;
      return Response.json(result ?? null, {
        status: options.status ?? 200,
        headers: { 'cache-control': 'no-store', 'x-request-id': meta.requestId ?? '' },
      });
    } catch (error) {
      return toProblem(error, meta, logger);
    }
  };
}
