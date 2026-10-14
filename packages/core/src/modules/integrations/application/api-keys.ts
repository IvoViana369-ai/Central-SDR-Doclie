import type { Prisma } from '@docline/db';
import type { Actor } from '../../../shared/actor';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthenticatedError,
  ValidationError,
} from '../../../shared/errors';
import {
  auditData,
  defineUseCase,
  type CoreDeps,
  type RequestMeta,
} from '../../../shared/use-case';
import { isApiScope, type ApiScope } from '../../identity';
import { createApiKeyInput, listApiKeysInput, revokeApiKeyInput } from '../contracts/schemas';
import { apiKeyPrefix, systemLabel } from '../domain/references';
import { generateApiKey, hashApiKey } from '../domain/signing';

export type ApiKeyActor = Extract<Actor, { kind: 'apiKey' }>;
export type ApiKeyStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

const apiKeySelect = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  system: true,
  rateLimitPerMinute: true,
  expiresAt: true,
  lastUsedAt: true,
  lastUsedIp: true,
  createdById: true,
  createdAt: true,
  revokedAt: true,
  revokedById: true,
  revokeReason: true,
} satisfies Prisma.ApiKeySelect;

type ApiKeyRow = Prisma.ApiKeyGetPayload<{ select: typeof apiKeySelect }>;

function statusOf(key: Pick<ApiKeyRow, 'revokedAt' | 'expiresAt'>, now: Date): ApiKeyStatus {
  if (key.revokedAt) return 'REVOKED';
  if (key.expiresAt && key.expiresAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

function describeKey(key: ApiKeyRow, now: Date, names: Map<string, string> = new Map()) {
  return {
    ...key,
    status: statusOf(key, now),
    systemLabel: key.system ? systemLabel(key.system) : null,
    createdByName: key.createdById ? (names.get(key.createdById) ?? null) : null,
    revokedByName: key.revokedById ? (names.get(key.revokedById) ?? null) : null,
  };
}

export type ApiKeyView = ReturnType<typeof describeKey>;

/** Cria a chave (F12-01). A chave inteira volta só nesta resposta. */
export const createApiKey = defineUseCase({
  name: 'integrations.createApiKey',
  access: 'integration.manage',
  input: createApiKeyInput,
  async run(ctx, input) {
    if (input.expiresAt && input.expiresAt <= ctx.now) {
      throw new ValidationError([{ path: 'expiresAt', message: 'A validade precisa ser futura.' }]);
    }
    const generated = generateApiKey();
    const key = await ctx.tx.apiKey.create({
      data: {
        name: input.name,
        prefix: generated.prefix,
        keyHash: generated.hash,
        scopes: input.scopes,
        system: input.system ?? null,
        ...(input.rateLimitPerMinute ? { rateLimitPerMinute: input.rateLimitPerMinute } : {}),
        expiresAt: input.expiresAt ?? null,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        createdAt: ctx.now,
      },
      select: apiKeySelect,
    });
    await ctx.audit({
      action: 'api_key.create',
      entityType: 'api_key',
      entityId: key.id,
      changes: { name: [null, key.name], scopes: [null, key.scopes] },
      metadata: {
        prefix: key.prefix,
        system: key.system,
        rateLimitPerMinute: key.rateLimitPerMinute,
        expiresAt: key.expiresAt?.toISOString() ?? null,
      },
    });
    return { apiKey: describeKey(key, ctx.now), key: generated.key };
  },
});

export const listApiKeys = defineUseCase({
  name: 'integrations.listApiKeys',
  access: 'integration.manage',
  input: listApiKeysInput,
  async run(ctx, input) {
    const keys = await ctx.tx.apiKey.findMany({
      where:
        input.status === 'ACTIVE'
          ? { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: ctx.now } }] }
          : {},
      select: apiKeySelect,
      orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
    const userIds = [
      ...new Set(keys.flatMap((k) => [k.createdById, k.revokedById]).filter((v) => v !== null)),
    ];
    const users = await ctx.tx.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return { data: keys.map((key) => describeKey(key, ctx.now, names)) };
  },
});

/** Revoga na hora (a próxima requisição com a chave já recebe 401). */
export const revokeApiKey = defineUseCase({
  name: 'integrations.revokeApiKey',
  access: 'integration.manage',
  input: revokeApiKeyInput,
  async run(ctx, input) {
    const key = await ctx.tx.apiKey.findUnique({
      where: { id: input.apiKeyId },
      select: apiKeySelect,
    });
    if (!key) throw new NotFoundError('Chave não encontrada.');
    if (key.revokedAt) throw new ConflictError('Esta chave já foi revogada.');
    const revoked = await ctx.tx.apiKey.update({
      where: { id: key.id },
      data: {
        revokedAt: ctx.now,
        revokedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        revokeReason: input.reason,
      },
      select: apiKeySelect,
    });
    await ctx.audit({
      action: 'api_key.revoke',
      entityType: 'api_key',
      entityId: key.id,
      changes: { revokedAt: [null, ctx.now] },
      metadata: { prefix: key.prefix, name: key.name, reason: input.reason },
    });
    return describeKey(revoked, ctx.now);
  },
});

interface AuthenticatedRow {
  id: string;
  name: string;
  scopes: string[];
  system: string | null;
  rate_window_start: Date;
  rate_window_count: number;
  rate_limit_per_minute: number;
}

/**
 * Autentica `Authorization: Bearer dsdr_…` (F12-01). Numa única atualização:
 * confere hash, revogação e validade, conta a requisição na janela de 1 minuto
 * e grava o último uso. Chave conhecida mas revogada ou vencida fica na
 * auditoria (alguém ainda a usa); chave desconhecida, só no log, pelo prefixo.
 */
export async function authenticateApiKey(
  deps: Pick<CoreDeps, 'db' | 'clock' | 'logger'>,
  rawKey: string,
  meta: RequestMeta = {},
): Promise<ApiKeyActor> {
  const invalid = new UnauthenticatedError('Chave de API inválida, revogada ou vencida.');
  const prefix = apiKeyPrefix(rawKey);
  if (!prefix) throw invalid;
  const hash = hashApiKey(rawKey);
  const now = deps.clock.now();
  const [row] = await deps.db.$queryRaw<AuthenticatedRow[]>`
    UPDATE api_keys SET
      rate_window_start = CASE
        WHEN rate_window_start IS NULL OR rate_window_start <= ${now}::timestamptz - interval '1 minute'
        THEN ${now}::timestamptz ELSE rate_window_start END,
      rate_window_count = CASE
        WHEN rate_window_start IS NULL OR rate_window_start <= ${now}::timestamptz - interval '1 minute'
        THEN 1 ELSE rate_window_count + 1 END,
      last_used_at = ${now}::timestamptz,
      last_used_ip = ${meta.ip ?? null}
    WHERE key_hash = ${hash}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ${now}::timestamptz)
    RETURNING id, name, scopes, system, rate_window_start, rate_window_count, rate_limit_per_minute`;

  if (!row) {
    const known = await deps.db.apiKey.findUnique({
      where: { keyHash: hash },
      select: { id: true, name: true, revokedAt: true, expiresAt: true },
    });
    // Uma linha a cada 10 minutos por chave basta para saber que ainda a usam.
    const recentlyAudited =
      known &&
      (await deps.db.auditLog.count({
        where: {
          action: 'api_key.rejected',
          entityId: known.id,
          occurredAt: { gt: new Date(now.getTime() - 10 * 60_000) },
        },
      })) > 0;
    if (known && !recentlyAudited) {
      await deps.db.auditLog.create({
        data: {
          ...auditData({ kind: 'system', name: 'api-auth' }, meta, {
            action: 'api_key.rejected',
            entityType: 'api_key',
            entityId: known.id,
            metadata: { prefix, name: known.name, reason: known.revokedAt ? 'REVOKED' : 'EXPIRED' },
          }),
          occurredAt: now,
        },
      });
    } else if (!known) {
      deps.logger.warn({ prefix, requestId: meta.requestId }, 'Chave de API desconhecida');
    }
    throw invalid;
  }

  if (row.rate_window_count > row.rate_limit_per_minute) {
    const elapsed = now.getTime() - new Date(row.rate_window_start).getTime();
    throw new RateLimitError(
      `Limite de ${row.rate_limit_per_minute} requisições por minuto desta chave atingido.`,
      Math.max(1, Math.ceil((60_000 - elapsed) / 1000)),
    );
  }
  return {
    kind: 'apiKey',
    id: row.id,
    name: row.name,
    scopes: row.scopes.filter(isApiScope),
    system: row.system,
  };
}

/**
 * Trava da rota (a primeira das duas): a chave precisa ter o escopo que a rota
 * declara. A negação fica na auditoria, como as do RBAC.
 */
export async function assertApiKeyScope(
  deps: Pick<CoreDeps, 'db'>,
  actor: ApiKeyActor,
  scope: ApiScope | 'any',
  route: string,
  meta: RequestMeta = {},
): Promise<void> {
  if (scope === 'any' || actor.scopes.includes(scope)) return;
  await deps.db.auditLog.create({
    data: auditData(actor, meta, {
      action: 'access.denied',
      entityType: 'route',
      entityId: route,
      metadata: { requiredScope: scope },
    }),
  });
  throw new ForbiddenError(`A chave de API não tem o escopo ${scope}.`);
}
