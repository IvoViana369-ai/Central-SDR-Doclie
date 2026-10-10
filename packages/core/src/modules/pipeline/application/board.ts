import type { Prisma } from '@docline/db';
import { NotFoundError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { CONTACT_STATUS_LABELS } from '../../compliance';
import { formatLeadCode, selectionWhere } from '../../leads';
import { pipelineBoardInput, stageCardsInput } from '../contracts/schemas';
import { requirePipeline, stageSelect } from './stages';

const DAY_MS = 86_400_000;

const cardSelect = {
  id: true,
  code: true,
  version: true,
  displayName: true,
  cityRaw: true,
  stateUf: true,
  score: true,
  scoreBand: true,
  stageEnteredAt: true,
  lastActivityAt: true,
  nextActionAt: true,
  hasWhatsapp: true,
  hasInstagram: true,
  contactStatus: true,
  owner: { select: { id: true, name: true } },
} satisfies Prisma.LeadSelect;

/** Prioridade dentro da coluna: maior score primeiro; empate, quem está há mais tempo na etapa. */
const cardOrder: Prisma.LeadOrderByWithRelationInput[] = [
  { score: { sort: 'desc', nulls: 'last' } },
  { stageEnteredAt: 'asc' },
  { id: 'asc' },
];

type CardRow = Prisma.LeadGetPayload<{ select: typeof cardSelect }>;

function toCard(lead: CardRow, now: Date, slaHours: number | null) {
  const inStageMs = lead.stageEnteredAt ? now.getTime() - lead.stageEnteredAt.getTime() : 0;
  return {
    id: lead.id,
    code: formatLeadCode(lead.code),
    version: lead.version,
    displayName: lead.displayName,
    city: lead.cityRaw,
    stateUf: lead.stateUf,
    score: lead.score,
    scoreBand: lead.scoreBand,
    ownerName: lead.owner?.name ?? null,
    daysInStage: Math.floor(inStageMs / DAY_MS),
    /** Passou do SLA configurado para a etapa. */
    overdue: slaHours !== null && inStageMs > slaHours * 3_600_000,
    /** Próxima ação agendada (tarefa aberta mais próxima), e se já venceu. */
    nextActionAt: lead.nextActionAt,
    nextActionOverdue: lead.nextActionAt !== null && lead.nextActionAt < now,
    hasWhatsapp: lead.hasWhatsapp,
    hasInstagram: lead.hasInstagram,
    contactStatus: lead.contactStatus,
    contactStatusLabel: CONTACT_STATUS_LABELS[lead.contactStatus],
    /** Selo "Não contatar": o gate bloqueia todos os canais. */
    doNotContact: lead.contactStatus === 'OPTED_OUT' || lead.contactStatus === 'BLOCKED',
  };
}

/** Leads ativos do pipeline que atendem à seleção, no escopo do ator. */
async function boardWhere(
  ctx: UseCaseContext,
  pipelineId: string,
  selection: Parameters<typeof selectionWhere>[1],
): Promise<Prisma.LeadWhereInput> {
  return { AND: [await selectionWhere(ctx, selection), { pipelineId, status: 'ACTIVE' }] };
}

/**
 * Quadro Kanban (docs/SDR-FLOW.md §3.3; F4-02): colunas com contagem e os
 * primeiros cards de cada uma, por prioridade. Cada coluna pagina sozinha.
 */
export const getPipelineBoard = defineUseCase({
  name: 'pipeline.board',
  access: 'lead.read',
  input: pipelineBoardInput,
  async run(ctx, input) {
    const pipeline = await requirePipeline(ctx, input.pipelineId);
    const where = await boardWhere(ctx, pipeline.id, input);
    const [stages, counts] = await Promise.all([
      ctx.tx.pipelineStage.findMany({
        where: { pipelineId: pipeline.id },
        orderBy: { position: 'asc' },
        select: stageSelect,
      }),
      ctx.tx.lead.groupBy({ by: ['stageId'], where, _count: { _all: true } }),
    ]);
    const countByStage = new Map(counts.map((c) => [c.stageId, c._count._all]));
    // Etapa desativada só aparece se ainda tiver leads (não deveria, mas nada some do quadro).
    const visible = stages.filter((s) => s.active || (countByStage.get(s.id) ?? 0) > 0);
    const columns = await Promise.all(
      visible.map(async (stage) => {
        const count = countByStage.get(stage.id) ?? 0;
        const rows = count
          ? await ctx.tx.lead.findMany({
              where: { AND: [where, { stageId: stage.id }] },
              orderBy: cardOrder,
              take: input.perColumn,
              select: cardSelect,
            })
          : [];
        return {
          stage,
          count,
          cards: rows.map((r) => toCard(r, ctx.now, stage.slaHours)),
          nextCursor: count > rows.length ? rows.length : null,
        };
      }),
    );
    return {
      pipeline,
      columns,
      total: counts.reduce((sum, c) => sum + c._count._all, 0),
    };
  },
});

/** Próxima página de cards de uma coluna. */
export const listStageCards = defineUseCase({
  name: 'pipeline.stageCards',
  access: 'lead.read',
  input: stageCardsInput,
  async run(ctx, input) {
    const pipeline = await requirePipeline(ctx, input.pipelineId);
    const stage = await ctx.tx.pipelineStage.findFirst({
      where: { id: input.stageId, pipelineId: pipeline.id },
      select: { id: true, slaHours: true },
    });
    if (!stage) throw new NotFoundError('Etapa não encontrada.');
    const where = { AND: [await boardWhere(ctx, pipeline.id, input), { stageId: stage.id }] };
    const offset = input.cursor ?? 0;
    const rows = await ctx.tx.lead.findMany({
      where,
      orderBy: cardOrder,
      skip: offset,
      take: input.limit + 1,
      select: cardSelect,
    });
    return {
      cards: rows.slice(0, input.limit).map((r) => toCard(r, ctx.now, stage.slaHours)),
      nextCursor: rows.length > input.limit ? offset + input.limit : null,
    };
  },
});
