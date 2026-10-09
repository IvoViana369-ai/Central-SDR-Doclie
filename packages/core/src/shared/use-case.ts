import type { DbClient, DbTransaction, Prisma } from '@docline/db';
import type { z } from 'zod';
import { roleHasPermission, type Permission } from '../modules/identity/domain/permissions';
import type { EmailProvider } from '../ports/email';
import type { PasswordHasher } from '../ports/password-hasher';
import type { Actor } from './actor';
import type { Clock } from './clock';
import type { IdentifierHasher } from './identifier-hash';
import { ForbiddenError, UnauthenticatedError, ValidationError } from './errors';
import type { Logger } from './logger';

/** Dependências injetadas pelas aplicações (web, worker, CLI). */
export interface CoreDeps {
  db: DbClient;
  clock: Clock;
  logger: Logger;
  email: EmailProvider;
  passwordHasher: PasswordHasher;
  /** HMAC de telefones, e-mails, Instagram e CNPJs (Lista Não Contatar). */
  identifiers: IdentifierHasher;
  /** URL pública da aplicação, usada em links de e-mail. */
  appUrl: string;
}

/** Metadados da requisição, gravados na auditoria. */
export interface RequestMeta {
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export type AuditChanges = Record<string, [unknown, unknown]>;

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: AuditChanges | null;
  metadata?: Record<string, unknown> | null;
  /** Sobrescreve o autor (ex.: convite aceito sem sessão é atribuído ao próprio usuário). */
  actorOverride?: { type: 'USER'; id: string };
}

export interface UseCaseContext {
  deps: CoreDeps;
  tx: DbTransaction;
  actor: Actor;
  meta: RequestMeta;
  /** Instante da execução (do relógio injetado). */
  now: Date;
  /** Grava na auditoria dentro da mesma transação. */
  audit(entry: AuditEntry): Promise<void>;
  /** Agenda uma tarefa para depois do commit (ex.: enviar e-mail). Falhas são registradas em log. */
  afterCommit(task: () => Promise<void>): void;
}

/**
 * Quem pode executar:
 * - uma permissão da matriz RBAC;
 * - 'authenticated': qualquer usuário ativo;
 * - 'public': sem sessão (ex.: aceitar convite).
 * Atores de sistema (worker/CLI) são confiáveis e passam em qualquer regra.
 */
export type Access = Permission | 'authenticated' | 'public';

export interface UseCase<S extends z.ZodType, O> {
  (deps: CoreDeps, actor: Actor, input: z.input<S>, meta?: RequestMeta): Promise<O>;
  readonly useCaseName: string;
  readonly access: Access;
}

export function checkAccess(actor: Actor, access: Access): void {
  if (access === 'public') return;
  if (actor.kind === 'anonymous') throw new UnauthenticatedError();
  if (actor.kind === 'system') return;
  if (actor.status !== 'ACTIVE') throw new UnauthenticatedError('Usuário sem acesso ativo.');
  if (access === 'authenticated') return;
  if (!roleHasPermission(actor.role, access)) throw new ForbiddenError();
}

/** Converte para JSON puro (datas viram ISO), como exige o tipo Json do Prisma. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function auditData(actor: Actor, meta: RequestMeta, entry: AuditEntry) {
  const base =
    entry.actorOverride ??
    (actor.kind === 'user'
      ? { type: 'USER' as const, id: actor.id }
      : { type: 'SYSTEM' as const, id: null });
  const metadata = {
    ...(actor.kind === 'system' && !entry.actorOverride ? { system: actor.name } : {}),
    ...entry.metadata,
  };
  return {
    actorType: base.type,
    actorId: base.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    ...(entry.changes ? { changes: toJson(entry.changes) } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata: toJson(metadata) } : {}),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    requestId: meta.requestId ?? null,
  };
}

/**
 * Define um caso de uso com o fluxo padrão (docs/ARCHITECTURE.md §5.3, regra 5):
 * autoriza → valida → executa em transação (persistência + auditoria) → pós-commit.
 */
export function defineUseCase<S extends z.ZodType, O>(definition: {
  name: string;
  access: Access;
  input: S;
  run(ctx: UseCaseContext, input: z.output<S>): Promise<O>;
}): UseCase<S, O> {
  const execute = async (
    deps: CoreDeps,
    actor: Actor,
    rawInput: z.input<S>,
    meta: RequestMeta = {},
  ) => {
    try {
      checkAccess(actor, definition.access);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        await deps.db.auditLog.create({
          data: auditData(actor, meta, {
            action: 'access.denied',
            entityType: 'use_case',
            entityId: definition.name,
            metadata: { required: definition.access },
          }),
        });
      }
      throw error;
    }

    const parsed = definition.input.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }

    const pending: (() => Promise<void>)[] = [];
    const now = deps.clock.now();
    const result = await deps.db.$transaction(
      async (tx) =>
        definition.run(
          {
            deps,
            tx,
            actor,
            meta,
            now,
            audit: async (entry) => {
              await tx.auditLog.create({
                data: { ...auditData(actor, meta, entry), occurredAt: now },
              });
            },
            afterCommit: (task) => {
              pending.push(task);
            },
          },
          parsed.data,
        ),
      { maxWait: 5_000, timeout: 15_000 },
    );

    for (const task of pending) {
      try {
        await task();
      } catch (error) {
        deps.logger.error({ err: error, useCase: definition.name }, 'Falha em tarefa pós-commit');
      }
    }
    return result;
  };

  return Object.assign(execute, { useCaseName: definition.name, access: definition.access });
}

/**
 * Verificação de acesso fora de um caso de uso (ex.: leituras simples na API),
 * com a mesma regra de auditoria de negações.
 */
export async function assertAccess(
  deps: Pick<CoreDeps, 'db'>,
  actor: Actor,
  access: Access,
  resource: string,
  meta: RequestMeta = {},
): Promise<void> {
  try {
    checkAccess(actor, access);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      await deps.db.auditLog.create({
        data: auditData(actor, meta, {
          action: 'access.denied',
          entityType: 'resource',
          entityId: resource,
          metadata: { required: access },
        }),
      });
    }
    throw error;
  }
}
