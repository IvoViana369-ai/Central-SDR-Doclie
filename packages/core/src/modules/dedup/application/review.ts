import type { DuplicateStatus, Prisma } from '@docline/db';
import { BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { formatLeadCode, LEAD_STATUS_LABELS, LEAD_TYPE_LABELS, leadScopeWhere } from '../../leads';
import { formatCnpj, formatPhone, formatPostalCode } from '../../normalization';
import { decideDuplicateInput, duplicateIdInput, listDuplicatesInput } from '../contracts/schemas';
import {
  defaultMergeChoices,
  fieldDiffers,
  MERGE_FIELD_KEYS,
  MERGE_FIELDS,
  type MergeField,
} from '../domain/merge';
import {
  CONFIDENCE_LABELS,
  RULE_LABELS,
  type DuplicateRule,
  type DuplicateSignal,
} from '../domain/scoring';

export const DUPLICATE_STATUS_LABELS: Record<DuplicateStatus, string> = {
  PENDING: 'Pendente',
  MERGED: 'Mesclado',
  KEPT_SEPARATE: 'Mantidos separados',
  IGNORED: 'Ignorado',
};

const OPEN_LEAD = { status: { in: ['ACTIVE' as const, 'ARCHIVED' as const] } };

/** Pares em que os dois leads estão no escopo do usuário. */
async function candidateScope(
  ctx: UseCaseContext,
  options: { openLeads: boolean },
): Promise<Prisma.DuplicateCandidateWhereInput> {
  const scope = await leadScopeWhere(ctx.tx, ctx.actor);
  const lead = { AND: [scope, ...(options.openLeads ? [OPEN_LEAD] : [])] };
  return { leadA: lead, leadB: lead };
}

/** Carrega o par travando a linha (duas decisões simultâneas não se cruzam). */
export async function lockCandidate(ctx: UseCaseContext, candidateId: string) {
  await ctx.tx
    .$queryRaw`SELECT id FROM duplicate_candidates WHERE id = ${candidateId}::uuid FOR UPDATE`;
  const scope = await candidateScope(ctx, { openLeads: false });
  const candidate = await ctx.tx.duplicateCandidate.findFirst({
    where: { AND: [{ id: candidateId }, scope] },
    select: {
      id: true,
      status: true,
      leadAId: true,
      leadBId: true,
      reasons: true,
      leadA: { select: { code: true, status: true } },
      leadB: { select: { code: true, status: true } },
    },
  });
  if (!candidate) throw new NotFoundError('Par de possíveis duplicados não encontrado.');
  return candidate;
}

const reasonsOf = (value: unknown) =>
  ((value as DuplicateSignal[] | null) ?? []).map((r) => ({
    rule: r.rule,
    label: RULE_LABELS[r.rule as DuplicateRule] ?? r.rule,
    detail: r.detail,
  }));

const summarySelect = {
  id: true,
  code: true,
  displayName: true,
  cityRaw: true,
  stateUf: true,
  status: true,
  createdAt: true,
  owner: { select: { name: true } },
} as const;

function leadSummary(lead: Prisma.LeadGetPayload<{ select: typeof summarySelect }>) {
  return {
    id: lead.id,
    code: formatLeadCode(lead.code),
    displayName: lead.displayName,
    city: lead.cityRaw,
    stateUf: lead.stateUf,
    status: lead.status,
    statusLabel: LEAD_STATUS_LABELS[lead.status],
    ownerName: lead.owner?.name ?? null,
    createdAt: lead.createdAt,
  };
}

/** Fila de possíveis duplicados (F3-09), da maior confiança para a menor. */
export const listDuplicates = defineUseCase({
  name: 'dedup.list',
  access: 'duplicate.decide',
  input: listDuplicatesInput,
  async run(ctx, input) {
    // Pares mesclados mostram o lead que virou MERGED; os demais, só leads em aberto.
    const scope = await candidateScope(ctx, { openLeads: input.status !== 'MERGED' });
    const base: Prisma.DuplicateCandidateWhereInput = {
      AND: [
        scope,
        { status: input.status },
        ...(input.rule ? [{ reasons: { array_contains: [{ rule: input.rule }] } }] : []),
      ],
    };
    const where = input.confidence ? { AND: [base, { confidence: input.confidence }] } : base;
    const offset = input.cursor ?? 0;
    const [rows, byConfidence] = await Promise.all([
      ctx.tx.duplicateCandidate.findMany({
        where,
        orderBy: [{ score: 'desc' }, { detectedAt: 'desc' }, { id: 'asc' }],
        skip: offset,
        take: input.limit + 1,
        select: {
          id: true,
          score: true,
          confidence: true,
          status: true,
          reasons: true,
          detectedBy: true,
          detectedAt: true,
          decidedAt: true,
          decisionNote: true,
          decidedBy: { select: { name: true } },
          leadA: { select: summarySelect },
          leadB: { select: summarySelect },
        },
      }),
      ctx.tx.duplicateCandidate.groupBy({
        by: ['confidence'],
        where: base,
        _count: { _all: true },
      }),
    ]);
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const g of byConfidence) counts[g.confidence] = g._count._all;
    return {
      data: rows.slice(0, input.limit).map((c) => ({
        id: c.id,
        score: c.score,
        confidence: c.confidence,
        confidenceLabel: CONFIDENCE_LABELS[c.confidence],
        status: c.status,
        statusLabel: DUPLICATE_STATUS_LABELS[c.status],
        reasons: reasonsOf(c.reasons),
        detectedBy: c.detectedBy,
        detectedAt: c.detectedAt,
        decidedAt: c.decidedAt,
        decidedByName: c.decidedBy?.name ?? null,
        decisionNote: c.decisionNote,
        leads: [leadSummary(c.leadA), leadSummary(c.leadB)],
      })),
      counts,
      nextCursor: rows.length > input.limit ? offset + input.limit : null,
    };
  },
});

export const compareSelect = {
  id: true,
  code: true,
  version: true,
  status: true,
  companyName: true,
  tradeName: true,
  displayName: true,
  leadType: true,
  segmentId: true,
  category: true,
  cnaeMain: true,
  cnpj: true,
  cnpjRoot: true,
  cnpjHash: true,
  municipalityCode: true,
  cityRaw: true,
  stateUf: true,
  addressLine: true,
  addressNumber: true,
  addressComplement: true,
  neighborhood: true,
  postalCode: true,
  websiteUrl: true,
  websiteDomain: true,
  ownerId: true,
  description: true,
  customFields: true,
  createdVia: true,
  createdAt: true,
  lastActivityAt: true,
  contactStatus: true,
  stageId: true,
  segment: { select: { name: true } },
  owner: { select: { name: true } },
  originSource: { select: { name: true } },
  stage: { select: { name: true } },
  contactPoints: {
    where: { status: { not: 'REMOVED' } },
    orderBy: [{ type: 'asc' }, { isPrimary: 'desc' }],
    select: {
      id: true,
      type: true,
      valueNormalized: true,
      status: true,
      whatsappStatus: true,
      isPrimary: true,
      label: true,
    },
  },
  people: {
    where: { status: 'ACTIVE' },
    select: { id: true, fullName: true, roleTitle: true, isPrimary: true },
  },
  tags: { select: { tag: { select: { id: true, name: true } } } },
  _count: {
    select: { notes: { where: { removedAt: null } }, events: true, origins: true },
  },
} satisfies Prisma.LeadSelect;

type CompareLead = Prisma.LeadGetPayload<{ select: typeof compareSelect }>;

/** Valor do grupo de campos, como texto para a tela. */
function displayField(lead: CompareLead, field: MergeField): string | null {
  switch (field) {
    case 'cnpj':
      return lead.cnpj ? formatCnpj(lead.cnpj) : null;
    case 'leadType':
      return LEAD_TYPE_LABELS[lead.leadType];
    case 'segment':
      return lead.segment?.name ?? null;
    case 'location':
      return lead.cityRaw
        ? `${lead.cityRaw}${lead.stateUf ? `/${lead.stateUf}` : ''}`
        : lead.stateUf;
    case 'address': {
      const parts = [
        [lead.addressLine, lead.addressNumber].filter(Boolean).join(', '),
        lead.addressComplement,
        lead.neighborhood,
        lead.postalCode ? `CEP ${formatPostalCode(lead.postalCode)}` : null,
      ].filter(Boolean);
      return parts.length ? parts.join(' — ') : null;
    }
    case 'website':
      return lead.websiteUrl;
    case 'owner':
      return lead.owner?.name ?? null;
    case 'stage':
      return lead.stage?.name ?? null;
    default:
      return (lead[field as 'tradeName'] as string | null) ?? null;
  }
}

function compareLead(lead: CompareLead) {
  return {
    id: lead.id,
    code: formatLeadCode(lead.code),
    version: lead.version,
    status: lead.status,
    statusLabel: LEAD_STATUS_LABELS[lead.status],
    displayName: lead.displayName,
    originSourceName: lead.originSource.name,
    createdVia: lead.createdVia,
    createdAt: lead.createdAt,
    lastActivityAt: lead.lastActivityAt,
    contactPoints: lead.contactPoints.map((cp) => ({
      id: cp.id,
      type: cp.type,
      display:
        cp.type === 'PHONE'
          ? formatPhone(cp.valueNormalized)
          : cp.type === 'INSTAGRAM'
            ? `@${cp.valueNormalized}`
            : cp.valueNormalized,
      valueNormalized: cp.valueNormalized,
      status: cp.status,
      whatsappStatus: cp.whatsappStatus,
      isPrimary: cp.isPrimary,
      label: cp.label,
    })),
    people: lead.people,
    tags: lead.tags.map((t) => t.tag),
    customFields: (lead.customFields as Record<string, string> | null) ?? {},
    counts: {
      notes: lead._count.notes,
      events: lead._count.events,
      origins: lead._count.origins,
    },
  };
}

/** Sugestão de quem fica: o ativo; entre iguais, o mais antigo (tem mais histórico). */
function suggestSurvivor(a: CompareLead, b: CompareLead): string {
  if (a.status !== b.status) return a.status === 'ACTIVE' ? a.id : b.id;
  return a.code <= b.code ? a.id : b.id;
}

/** Comparação lado a lado (F3-09): campos, contatos, pessoas, tags e contagens. */
export const getDuplicate = defineUseCase({
  name: 'dedup.get',
  access: 'duplicate.decide',
  input: duplicateIdInput,
  async run(ctx, input) {
    const scope = await candidateScope(ctx, { openLeads: false });
    const candidate = await ctx.tx.duplicateCandidate.findFirst({
      where: { AND: [{ id: input.candidateId }, scope] },
      select: {
        id: true,
        score: true,
        confidence: true,
        status: true,
        reasons: true,
        detectedBy: true,
        detectedAt: true,
        decidedAt: true,
        decisionNote: true,
        decidedBy: { select: { name: true } },
        leadA: { select: compareSelect },
        leadB: { select: compareSelect },
      },
    });
    if (!candidate) throw new NotFoundError('Par de possíveis duplicados não encontrado.');
    const { leadA: a, leadB: b } = candidate;
    return {
      id: candidate.id,
      score: candidate.score,
      confidence: candidate.confidence,
      confidenceLabel: CONFIDENCE_LABELS[candidate.confidence],
      status: candidate.status,
      statusLabel: DUPLICATE_STATUS_LABELS[candidate.status],
      reasons: reasonsOf(candidate.reasons),
      detectedBy: candidate.detectedBy,
      detectedAt: candidate.detectedAt,
      decidedAt: candidate.decidedAt,
      decidedByName: candidate.decidedBy?.name ?? null,
      decisionNote: candidate.decisionNote,
      leads: [compareLead(a), compareLead(b)],
      fields: MERGE_FIELD_KEYS.map((key) => ({
        key,
        label: MERGE_FIELDS[key].label,
        values: [displayField(a, key), displayField(b, key)],
        differs: fieldDiffers(a, b, key),
      })),
      suggestedSurvivorId: suggestSurvivor(a, b),
      /** Escolhas padrão para cada lead como sobrevivente. */
      defaultChoices: {
        [a.id]: defaultMergeChoices(a, b),
        [b.id]: defaultMergeChoices(b, a),
      },
      /** Só pares pendentes ou ignorados podem ser decididos. */
      canDecide:
        (candidate.status === 'PENDING' || candidate.status === 'IGNORED') &&
        [a.status, b.status].every((s) => s === 'ACTIVE' || s === 'ARCHIVED'),
    };
  },
});

async function decide(
  ctx: UseCaseContext,
  input: { candidateId: string; note: string | null },
  status: 'KEPT_SEPARATE' | 'IGNORED',
) {
  const candidate = await lockCandidate(ctx, input.candidateId);
  const allowed =
    candidate.status === 'PENDING' ||
    (candidate.status === 'IGNORED' && status === 'KEPT_SEPARATE');
  if (!allowed) {
    throw new BusinessRuleError(
      `Este par já foi decidido (${DUPLICATE_STATUS_LABELS[candidate.status].toLowerCase()}).`,
    );
  }
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
  await ctx.tx.duplicateCandidate.update({
    where: { id: candidate.id },
    data: { status, decidedById: actorId, decidedAt: ctx.now, decisionNote: input.note },
  });
  await ctx.audit({
    action: status === 'KEPT_SEPARATE' ? 'duplicate.keep_separate' : 'duplicate.ignore',
    entityType: 'duplicate_candidate',
    entityId: candidate.id,
    changes: { status: [candidate.status, status] },
    metadata: {
      leads: [formatLeadCode(candidate.leadA.code), formatLeadCode(candidate.leadB.code)],
      leadIds: [candidate.leadAId, candidate.leadBId],
      ...(input.note ? { note: input.note } : {}),
    },
  });
  return { id: candidate.id, status };
}

/** "Manter separados": o par não volta à fila, nem com sinais novos (aceite M06). */
export const keepDuplicatesSeparate = defineUseCase({
  name: 'dedup.keepSeparate',
  access: 'duplicate.decide',
  input: decideDuplicateInput,
  run: (ctx, input) => decide(ctx, input, 'KEPT_SEPARATE'),
});

/** "Ignorar por agora": sai da fila e só volta se surgir um motivo novo. */
export const ignoreDuplicate = defineUseCase({
  name: 'dedup.ignore',
  access: 'duplicate.decide',
  input: decideDuplicateInput,
  run: (ctx, input) => decide(ctx, input, 'IGNORED'),
});
