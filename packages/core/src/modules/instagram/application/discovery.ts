import type { DbClient } from '@docline/db';
import { z } from 'zod';
import { InstagramProviderError, type InstagramDiscovery } from '../../../ports/instagram';
import { systemActor, type Actor } from '../../../shared/actor';
import { BusinessRuleError } from '../../../shared/errors';
import {
  checkAccess,
  defineUseCase,
  type CoreDeps,
  type RequestMeta,
} from '../../../shared/use-case';
import { auditLead, requireEditableLead } from '../../leads';
import { recomputeLeadScores } from '../../scoring';
import { leadInstagramInput } from '../contracts/schemas';
import { describeInstagramError } from '../domain/errors';
import {
  discoveryCutoffs,
  INSTAGRAM_SETTINGS_KEY,
  resolveInstagramSettings,
  type InstagramSettings,
} from '../domain/settings';
import { markInstagramConnection } from '../infra/connection';

/**
 * Métricas públicas dos perfis dos leads (F8-04; docs/INTEGRATIONS.md §7.2):
 * Business Discovery, a consulta oficial da Meta a contas profissionais. Fica
 * só o necessário para o critério "Instagram ativo" e a ficha: seguidores,
 * número de publicações e a data da última. Nada de legendas, fotos ou
 * comentários.
 *
 * O job roda de hora em hora com um teto de consultas (configuração); leads
 * fora de contato (opt-out ou bloqueados) não são consultados. Limite da Meta
 * interrompe a rodada; a próxima continua de onde parou.
 */

interface Target {
  contactPointId: string;
  leadId: string;
  handle: string;
}

/** Consulta mais recente que esta não se repete na atualização pela ficha. */
const MANUAL_REFRESH_MINUTES = 60;

/**
 * Contatos a consultar: nunca consultados ou com o @ trocado primeiro, depois
 * os mais antigos (falhas voltam antes da validade inteira).
 */
async function discoveryTargets(
  db: DbClient,
  settings: InstagramSettings,
  now: Date,
): Promise<Target[]> {
  const { refreshBefore, errorRetryBefore } = discoveryCutoffs(settings, now);
  return db.$queryRaw<Target[]>`
    SELECT cp.id AS "contactPointId", cp.lead_id AS "leadId", cp.value_normalized AS handle
    FROM contact_points cp
    JOIN leads l ON l.id = cp.lead_id
    LEFT JOIN instagram_profiles p ON p.contact_point_id = cp.id
    WHERE cp.type = 'INSTAGRAM'
      AND cp.status = 'ACTIVE'
      AND l.status = 'ACTIVE'
      AND l.contact_status NOT IN ('OPTED_OUT', 'BLOCKED')
      AND (
        p.id IS NULL
        OR p.handle <> cp.value_normalized
        OR (p.status <> 'ERROR' AND p.checked_at < ${refreshBefore})
        OR (p.status = 'ERROR' AND p.checked_at < ${errorRetryBefore})
      )
    ORDER BY (p.id IS NULL OR p.handle <> cp.value_normalized) DESC,
      p.checked_at ASC NULLS FIRST,
      cp.created_at ASC
    LIMIT ${settings.discoveryPerHour}
  `;
}

type Outcome =
  | {
      kind: 'found';
      followersCount: number | null;
      mediaCount: number | null;
      lastPostAt: Date | null;
    }
  | { kind: 'not_found' }
  | { kind: 'error'; code: string };

const outcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('found'),
    followersCount: z.number().int().nonnegative().nullable(),
    mediaCount: z.number().int().nonnegative().nullable(),
    lastPostAt: z.date().nullable(),
  }),
  z.object({ kind: z.literal('not_found') }),
  z.object({ kind: z.literal('error'), code: z.string().min(1) }),
]);

/** Grava a consulta de um @ nos contatos que ainda o têm e recalcula o score. */
const recordDiscovery = defineUseCase({
  name: 'instagram.discovery.record',
  access: 'lead.update',
  input: z.object({
    handle: z.string().min(1),
    contactPointIds: z.array(z.uuid()).min(1),
    outcome: outcomeSchema,
  }),
  async run(ctx, input) {
    const points = await ctx.tx.contactPoint.findMany({
      where: {
        id: { in: input.contactPointIds },
        type: 'INSTAGRAM',
        valueNormalized: input.handle,
      },
      select: { id: true, leadId: true, instagramProfile: { select: { handle: true } } },
    });
    const { outcome } = input;
    for (const point of points) {
      const sameHandle = point.instagramProfile?.handle === input.handle;
      const data =
        outcome.kind === 'found'
          ? {
              status: 'FOUND' as const,
              followersCount: outcome.followersCount,
              mediaCount: outcome.mediaCount,
              lastPostAt: outcome.lastPostAt,
              errorCode: null,
            }
          : outcome.kind === 'not_found'
            ? {
                status: 'NOT_FOUND' as const,
                followersCount: null,
                mediaCount: null,
                lastPostAt: null,
                errorCode: null,
              }
            : {
                status: 'ERROR' as const,
                errorCode: outcome.code,
                // Falha não apaga o que se sabia do mesmo @ (o score usa a última publicação conhecida).
                ...(sameHandle ? {} : { followersCount: null, mediaCount: null, lastPostAt: null }),
              };
      await ctx.tx.instagramProfile.upsert({
        where: { contactPointId: point.id },
        create: { contactPointId: point.id, handle: input.handle, ...data, checkedAt: ctx.now },
        update: { handle: input.handle, ...data, checkedAt: ctx.now },
      });
    }
    const leadIds = [...new Set(points.map((p) => p.leadId))];
    await recomputeLeadScores(ctx.tx, leadIds, 'instagram', ctx.now);
    return { updated: points.length };
  },
});

const recordAuthFailure = defineUseCase({
  name: 'instagram.discovery.auth',
  access: 'integration.manage',
  input: z.object({ provider: z.string(), code: z.string() }),
  async run(ctx, input) {
    await markInstagramConnection(
      ctx,
      input.provider,
      'ERROR',
      describeInstagramError(input.code).message,
    );
  },
});

export interface DiscoverySummary {
  checked: number;
  found: number;
  notFound: number;
  errors: number;
  /** Rodada interrompida: limite da Meta, Meta fora do ar ou token recusado. */
  stopped: 'RATE_LIMITED' | 'UNAVAILABLE' | 'AUTH' | null;
}

/** Consulta cada @ uma vez (fora da transação) e grava em todos os contatos com ele. */
async function discoverTargets(
  deps: CoreDeps,
  actor: Actor,
  targets: Target[],
): Promise<DiscoverySummary> {
  const provider = deps.instagram!;
  const byHandle = new Map<string, Target[]>();
  for (const t of targets) byHandle.set(t.handle, [...(byHandle.get(t.handle) ?? []), t]);
  const summary: DiscoverySummary = { checked: 0, found: 0, notFound: 0, errors: 0, stopped: null };
  for (const [handle, points] of byHandle) {
    let outcome: Outcome;
    try {
      const result: InstagramDiscovery = await provider.discover(handle);
      outcome = result.found
        ? {
            kind: 'found',
            followersCount: result.followersCount,
            mediaCount: result.mediaCount,
            lastPostAt: result.lastPostAt,
          }
        : { kind: 'not_found' };
    } catch (error) {
      if (!(error instanceof InstagramProviderError)) throw error;
      const { kind } = describeInstagramError(error.details.code);
      if (kind === 'RATE_LIMITED' || kind === 'UNAVAILABLE') {
        summary.stopped = kind;
        break;
      }
      if (kind === 'AUTH') {
        await recordAuthFailure(deps, systemActor('instagram.discovery'), {
          provider: provider.name,
          code: error.details.code,
        });
        summary.stopped = 'AUTH';
        break;
      }
      outcome = { kind: 'error', code: error.details.code };
    }
    await recordDiscovery(deps, actor, {
      handle,
      contactPointIds: points.map((p) => p.contactPointId),
      outcome,
    });
    summary.checked += 1;
    if (outcome.kind === 'found') summary.found += 1;
    else if (outcome.kind === 'not_found') summary.notFound += 1;
    else summary.errors += 1;
  }
  return summary;
}

/** Job `instagram.discovery` (de hora em hora). */
export async function runInstagramDiscovery(deps: CoreDeps) {
  if (!deps.instagram) return { status: 'disabled' as const };
  const row = await deps.db.appSetting.findUnique({ where: { key: INSTAGRAM_SETTINGS_KEY } });
  const settings = resolveInstagramSettings(row?.value);
  if (!settings.discoveryEnabled) return { status: 'disabled' as const };
  const targets = await discoveryTargets(deps.db, settings, deps.clock.now());
  const summary = await discoverTargets(deps, systemActor('instagram.discovery'), targets);
  deps.logger.info({ ...summary }, 'Consulta de perfis do Instagram');
  return { status: 'processed' as const, ...summary };
}

/** Contatos do lead para "Atualizar" na ficha (com o registro do pedido). */
const refreshTargets = defineUseCase({
  name: 'instagram.discovery.refresh',
  access: 'lead.update',
  input: leadInstagramInput,
  async run(ctx, input) {
    const lead = await requireEditableLead(ctx, input.leadId, { id: true });
    const points = await ctx.tx.contactPoint.findMany({
      where: { leadId: lead.id, type: 'INSTAGRAM', status: 'ACTIVE' },
      select: {
        id: true,
        valueNormalized: true,
        instagramProfile: { select: { handle: true, checkedAt: true } },
      },
    });
    if (points.length === 0) throw new BusinessRuleError('O lead não tem Instagram cadastrado.');
    const recent = new Date(ctx.now.getTime() - MANUAL_REFRESH_MINUTES * 60_000);
    const due = points.filter(
      (p) =>
        !p.instagramProfile ||
        p.instagramProfile.handle !== p.valueNormalized ||
        p.instagramProfile.checkedAt < recent,
    );
    if (due.length > 0) {
      await auditLead(ctx, lead.id, 'instagram.discovery.refresh', {
        metadata: { contactPoints: due.length },
      });
    }
    return due.map((p) => ({ contactPointId: p.id, leadId: lead.id, handle: p.valueNormalized }));
  },
});

/** "Atualizar" as métricas do Instagram na ficha (mesmas regras do job). */
export async function refreshLeadInstagram(
  deps: CoreDeps,
  actor: Actor,
  input: unknown,
  meta: RequestMeta = {},
) {
  checkAccess(actor, 'lead.update');
  if (!deps.instagram) {
    throw new BusinessRuleError('O Instagram pela API não está ativo (modo assistido).');
  }
  const row = await deps.db.appSetting.findUnique({ where: { key: INSTAGRAM_SETTINGS_KEY } });
  if (!resolveInstagramSettings(row?.value).discoveryEnabled) {
    throw new BusinessRuleError('A consulta de perfis do Instagram está desligada.');
  }
  const targets = await refreshTargets(deps, actor, leadInstagramInput.parse(input), meta);
  const summary = await discoverTargets(deps, actor, targets);
  if (summary.stopped) {
    throw new BusinessRuleError(
      summary.stopped === 'AUTH'
        ? 'A Meta recusou o acesso do Instagram. Avise o administrador.'
        : 'A Meta limitou as consultas agora. Tente de novo em alguns minutos.',
    );
  }
  return summary;
}
