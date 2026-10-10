import { Prisma, type DbClient, type DbTransaction } from '@docline/db';
import { z } from 'zod';
import { JOBS } from '../../../jobs/catalog';
import { systemActor } from '../../../shared/actor';
import { DEFAULT_TIME_ZONE, isoDate, localParts } from '../../../shared/calendar';
import { NotFoundError, ValidationError } from '../../../shared/errors';
import {
  defineUseCase,
  toJson,
  type CoreDeps,
  type UseCaseContext,
} from '../../../shared/use-case';
import { notify } from '../../notifications';
import { autoAssignSettingsInput, userAvailabilityInput } from '../contracts/schemas';
import {
  AUTO_ASSIGN_BATCH,
  AUTO_ASSIGN_KEY,
  AUTO_ASSIGN_STRATEGIES,
  capacityOf,
  isAvailable,
  planAutoAssign,
  resolveAutoAssignSettings,
  type AssignableLead,
  type AssignableSdr,
  type AutoAssignSettings,
  type AutoAssignSkip,
} from '../domain/auto-assign';
import { changeOwner } from './assignment';

/**
 * Distribuição automática do pool (F11-05; docs/SDR-FLOW.md §10.2). Desligada
 * por padrão. Ligada, o job `leads.auto-assign` (de hora em hora) entrega os
 * leads sem responsável aos SDRs disponíveis, por território ou rodízio, sem
 * passar do limite de leads ativos de cada um. Nunca tira o lead de alguém
 * (só atribui quem ainda está sem responsável) e não mexe em lead reservado
 * por uma campanha em andamento.
 */

export const AUTO_ASSIGN_LAST_RUN_KEY = 'leads.auto_assign.last_run';

/** Atribuições por transação. */
const CHUNK = 50;

export interface AutoAssignRun {
  at: string;
  candidates: number;
  assigned: number;
  skipped: Partial<Record<AutoAssignSkip, number>>;
}

const actorId = (ctx: UseCaseContext) => (ctx.actor.kind === 'user' ? ctx.actor.id : null);
const todayIso = (now: Date) => isoDate(localParts(now, DEFAULT_TIME_ZONE));
const dateIso = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

async function loadSettings(db: DbTransaction | DbClient) {
  const row = await db.appSetting.findUnique({ where: { key: AUTO_ASSIGN_KEY } });
  return resolveAutoAssignSettings(row?.value);
}

/** SDRs ativos com o que a distribuição precisa: carga, última entrega, território. */
async function loadSdrs(db: DbTransaction | DbClient): Promise<AssignableSdr[]> {
  const users = await db.user.findMany({
    where: { role: 'SDR', status: 'ACTIVE' },
    select: {
      id: true,
      autoAssign: true,
      awayUntil: true,
      maxActiveLeads: true,
      territories: { select: { stateUf: true, municipalityCode: true } },
    },
    orderBy: { id: 'asc' },
  });
  const ids = users.map((u) => u.id);
  const loads = await db.lead.groupBy({
    by: ['ownerId'],
    where: { ownerId: { in: ids }, status: 'ACTIVE' },
    _count: { _all: true },
  });
  const last = await db.leadAssignment.groupBy({
    by: ['toUserId'],
    where: { toUserId: { in: ids }, strategy: { in: [...AUTO_ASSIGN_STRATEGIES] } },
    _max: { assignedAt: true },
  });
  const loadBy = new Map(loads.map((l) => [l.ownerId, l._count._all]));
  const lastBy = new Map(last.map((l) => [l.toUserId, l._max.assignedAt]));
  return users.map((u) => ({
    userId: u.id,
    autoAssign: u.autoAssign,
    awayUntil: dateIso(u.awayUntil),
    maxActiveLeads: u.maxActiveLeads,
    activeLeads: loadBy.get(u.id) ?? 0,
    lastAssignedAt: lastBy.get(u.id) ?? null,
    territories: u.territories,
  }));
}

/**
 * Leads que a distribuição pode entregar: no pool, ativos, contatáveis, numa
 * etapa de prospecção, fora de campanha em andamento e, se o pool antigo não
 * entra, criados depois de a distribuição ser ligada.
 */
async function loadCandidates(
  db: DbClient,
  settings: AutoAssignSettings,
): Promise<AssignableLead[]> {
  const since =
    settings.includeExistingPool || !settings.enabledAt
      ? Prisma.empty
      : Prisma.sql`AND l.created_at >= ${new Date(settings.enabledAt)}`;
  return db.$queryRaw<AssignableLead[]>`
    SELECT l.id AS "leadId", l.state_uf AS "stateUf", l.municipality_code AS "municipalityCode",
      COALESCE(l.score, 0)::int AS priority
    FROM leads l
    JOIN pipeline_stages s ON s.id = l.stage_id
    WHERE l.owner_id IS NULL AND l.status = 'ACTIVE'
      AND l.contact_status NOT IN ('OPTED_OUT', 'BLOCKED')
      AND s.category IN ('OPEN', 'PARKED') ${since}
      AND NOT EXISTS (
        SELECT 1 FROM campaign_leads cl JOIN campaigns c ON c.id = cl.campaign_id
        WHERE cl.lead_id = l.id AND cl.status = 'PENDING'
          AND c.status IN ('BUILDING', 'READY', 'ACTIVE', 'PAUSED')
      )
    ORDER BY l.score DESC NULLS LAST, l.created_at, l.id
    LIMIT ${AUTO_ASSIGN_BATCH}
  `;
}

const applyInput = z.object({
  assignments: z
    .array(
      z.object({
        leadId: z.uuid(),
        userId: z.uuid(),
        strategy: z.enum(AUTO_ASSIGN_STRATEGIES),
      }),
    )
    .max(CHUNK),
});

/** Grava um lote: só leva o lead se ele ainda estiver no pool (trava como no "puxar"). */
const applyAutoAssign = defineUseCase({
  name: 'leads.autoAssign.apply',
  access: 'lead.assign',
  input: applyInput,
  async run(ctx, input) {
    const assigned: { leadId: string; userId: string }[] = [];
    for (const { leadId, userId, strategy } of input.assignments) {
      const taken = await ctx.tx.lead.updateMany({
        where: { id: leadId, ownerId: null, status: 'ACTIVE' },
        data: { ownerId: userId },
      });
      if (taken.count === 0) continue; // alguém pegou antes
      await changeOwner(
        ctx,
        { id: leadId, ownerId: null },
        userId,
        strategy,
        'Distribuição automática.',
      );
      assigned.push({ leadId, userId });
    }
    return assigned;
  },
});

/** Job `leads.auto-assign` (de hora em hora, ou logo depois de ligar). */
export async function runAutoAssign(deps: CoreDeps) {
  const now = deps.clock.now();
  const settings = await loadSettings(deps.db);
  if (!settings.enabled) {
    return {
      enabled: false,
      at: now.toISOString(),
      candidates: 0,
      assigned: 0,
      skipped: {},
      errors: 0,
    };
  }
  const actor = systemActor('leads.auto-assign');
  const candidates = await loadCandidates(deps.db, settings);
  const sdrs = await loadSdrs(deps.db);
  const plan = planAutoAssign(candidates, sdrs, settings, todayIso(now));

  const perUser = new Map<string, number>();
  let errors = 0;
  for (let i = 0; i < plan.assignments.length; i += CHUNK) {
    try {
      const done = await applyAutoAssign(deps, actor, {
        assignments: plan.assignments.slice(i, i + CHUNK),
      });
      for (const { userId } of done) perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
    } catch (error) {
      errors += 1;
      deps.logger.error({ err: error }, 'Falha ao gravar lote da distribuição automática');
    }
  }
  const assigned = [...perUser.values()].reduce((sum, n) => sum + n, 0);
  const skipped: AutoAssignRun['skipped'] = {};
  for (const { reason } of plan.skipped) skipped[reason] = (skipped[reason] ?? 0) + 1;
  const run: AutoAssignRun = {
    at: now.toISOString(),
    candidates: candidates.length,
    assigned,
    skipped,
  };

  await deps.db.$transaction(async (tx) => {
    for (const [userId, count] of perUser) {
      await notify(tx, {
        userId,
        type: 'leads.assigned',
        title: count === 1 ? '1 novo lead para você' : `${count} novos leads para você`,
        body: 'Distribuição automática do pool.',
        link: '/fila',
      });
    }
    await tx.appSetting.upsert({
      where: { key: AUTO_ASSIGN_LAST_RUN_KEY },
      create: { key: AUTO_ASSIGN_LAST_RUN_KEY, value: toJson(run) },
      update: { value: toJson(run) },
    });
  });
  deps.logger.info({ ...run, errors }, 'Distribuição automática concluída');
  return { enabled: true, ...run, errors };
}

/** Configuração, última execução e a equipe com a disponibilidade de cada um. */
export const getAutoAssignSettings = defineUseCase({
  name: 'leads.autoAssign.settings',
  access: 'lead.assign',
  input: z.object({}),
  async run(ctx) {
    const settings = await loadSettings(ctx.tx);
    const lastRun = await ctx.tx.appSetting.findUnique({
      where: { key: AUTO_ASSIGN_LAST_RUN_KEY },
    });
    const sdrs = await loadSdrs(ctx.tx);
    const names = await ctx.tx.user.findMany({
      where: { id: { in: sdrs.map((s) => s.userId) } },
      select: { id: true, name: true },
    });
    const nameBy = new Map(names.map((n) => [n.id, n.name]));
    const today = todayIso(ctx.now);
    return {
      settings,
      lastRun: (lastRun?.value as AutoAssignRun | undefined) ?? null,
      team: sdrs
        .map((s) => ({
          ...s,
          name: nameBy.get(s.userId) ?? '',
          capacity: capacityOf(s, settings.defaultCapacity),
          availableToday: isAvailable(s, today),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    };
  },
});

/** Liga, desliga ou ajusta a distribuição (ADMIN e GESTOR), com o antes e depois na auditoria. */
export const updateAutoAssignSettings = defineUseCase({
  name: 'leads.autoAssign.update',
  access: 'lead.assign',
  input: autoAssignSettingsInput,
  async run(ctx, input) {
    const before = await loadSettings(ctx.tx);
    const after: AutoAssignSettings = {
      ...input,
      // "Novos" contam a partir de quando foi ligada (religar começa de novo).
      enabledAt: input.enabled
        ? before.enabled && before.enabledAt
          ? before.enabledAt
          : ctx.now.toISOString()
        : null,
    };
    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of Object.keys(after) as (keyof AutoAssignSettings)[]) {
      if (before[key] !== after[key]) changes[key] = [before[key], after[key]];
    }
    await ctx.tx.appSetting.upsert({
      where: { key: AUTO_ASSIGN_KEY },
      create: { key: AUTO_ASSIGN_KEY, value: toJson(after), updatedById: actorId(ctx) },
      update: { value: toJson(after), updatedById: actorId(ctx) },
    });
    await ctx.audit({
      action: 'leads.auto_assign_update',
      entityType: 'app_setting',
      entityId: AUTO_ASSIGN_KEY,
      changes,
    });
    // Ligada agora: distribui sem esperar a próxima hora.
    if (after.enabled) {
      await ctx.deps.jobs.enqueue(
        JOBS.leadsAutoAssign.name,
        {},
        { tx: ctx.tx, singletonKey: 'leads.auto-assign' },
      );
    }
    return after;
  },
});

/** Participação, limite próprio e ausência de uma pessoa (ADMIN e GESTOR). */
export const updateUserAvailability = defineUseCase({
  name: 'leads.updateAvailability',
  access: 'lead.assign',
  input: userAvailabilityInput,
  async run(ctx, input) {
    const user = await ctx.tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, autoAssign: true, maxActiveLeads: true, awayUntil: true },
    });
    if (!user) throw new NotFoundError('Usuário não encontrado.');
    let awayUntil: Date | null | undefined;
    if (input.awayUntil !== undefined) {
      awayUntil = input.awayUntil === null ? null : new Date(`${input.awayUntil}T00:00:00Z`);
      if (awayUntil && dateIso(awayUntil) !== input.awayUntil) {
        throw new ValidationError([{ path: 'awayUntil', message: 'Data inválida.' }]);
      }
    }
    const data = {
      ...(input.autoAssign !== undefined ? { autoAssign: input.autoAssign } : {}),
      ...(input.maxActiveLeads !== undefined ? { maxActiveLeads: input.maxActiveLeads } : {}),
      ...(awayUntil !== undefined ? { awayUntil } : {}),
    };
    const updated = await ctx.tx.user.update({
      where: { id: user.id },
      data,
      select: { id: true, autoAssign: true, maxActiveLeads: true, awayUntil: true },
    });
    const changes: Record<string, [unknown, unknown]> = {};
    if (user.autoAssign !== updated.autoAssign) {
      changes.autoAssign = [user.autoAssign, updated.autoAssign];
    }
    if (user.maxActiveLeads !== updated.maxActiveLeads) {
      changes.maxActiveLeads = [user.maxActiveLeads, updated.maxActiveLeads];
    }
    if (dateIso(user.awayUntil) !== dateIso(updated.awayUntil)) {
      changes.awayUntil = [dateIso(user.awayUntil), dateIso(updated.awayUntil)];
    }
    await ctx.audit({
      action: 'user.availability_update',
      entityType: 'user',
      entityId: user.id,
      changes,
    });
    return { ...updated, awayUntil: dateIso(updated.awayUntil) };
  },
});

/** Distribuir agora (ADMIN e GESTOR): roda o job sem esperar a próxima hora. */
export const requestAutoAssign = defineUseCase({
  name: 'leads.autoAssign.request',
  access: 'lead.assign',
  input: z.object({}),
  async run(ctx) {
    const jobId = await ctx.deps.jobs.enqueue(
      JOBS.leadsAutoAssign.name,
      {},
      { tx: ctx.tx, singletonKey: 'leads.auto-assign' },
    );
    await ctx.audit({
      action: 'leads.auto_assign_requested',
      entityType: 'app_setting',
      entityId: AUTO_ASSIGN_KEY,
    });
    return { queued: jobId !== null };
  },
});
