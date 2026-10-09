import type { Prisma } from '@docline/db';
import type { OutreachContext } from '../domain/context';
import type { GuardrailFlag } from '../domain/guardrails';
import { AI_KIND_LABELS, type AiGenerationKindKey } from '../domain/kinds';

export const AI_STATUS_LABELS = {
  GENERATED: 'Rascunho',
  EDITED: 'Editado',
  APPROVED: 'Aprovado',
  DISCARDED: 'Descartado',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  BLOCKED: 'Bloqueado',
} as const;

export const generationSelect = {
  id: true,
  leadId: true,
  kind: true,
  channel: true,
  status: true,
  promptId: true,
  promptVersion: true,
  provider: true,
  model: true,
  inputSnapshot: true,
  output: true,
  textGenerated: true,
  textFinal: true,
  editDistanceRatio: true,
  guardrailFlags: true,
  discardReason: true,
  rating: true,
  feedback: true,
  costEstimateUsd: true,
  latencyMs: true,
  errorCode: true,
  approvedAt: true,
  createdAt: true,
  approach: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  messages: {
    where: { status: { not: 'CANCELED' } },
    select: { id: true, status: true },
  },
} satisfies Prisma.AiGenerationSelect;

export type GenerationRow = Prisma.AiGenerationGetPayload<{ select: typeof generationSelect }>;

/** Contexto gravado (com os fatos do prompt de sistema). */
export type StoredContext = OutreachContext & {
  systemFacts?: { key: string; version: number; content: string }[];
};

export function describeGeneration(g: GenerationRow) {
  const snapshot = (g.inputSnapshot ?? {}) as Partial<StoredContext>;
  const output = (g.output ?? null) as Record<string, unknown> | null;
  const flags = (Array.isArray(g.guardrailFlags)
    ? g.guardrailFlags
    : []) as unknown as GuardrailFlag[];
  return {
    id: g.id,
    leadId: g.leadId,
    kind: g.kind,
    kindLabel: AI_KIND_LABELS[g.kind as AiGenerationKindKey],
    channel: g.channel,
    status: g.status,
    statusLabel: AI_STATUS_LABELS[g.status],
    /** Texto atual: o final (editado ou aprovado) ou o rascunho. */
    text: g.textFinal ?? g.textGenerated,
    textGenerated: g.textGenerated,
    editDistanceRatio: g.editDistanceRatio === null ? null : Number(g.editDistanceRatio),
    flags,
    blocking: flags.some((f) => f.severity === 'BLOCKING'),
    /** Avisos de contexto fraco (sem cidade, sem responsável…). */
    contextWarnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
    assumptions: (output?.assumptions as string[] | undefined) ?? [],
    missingInfo: (output?.missingInfo as string[] | undefined) ?? [],
    personalizationPoints: (output?.personalizationPoints as string[] | undefined) ?? [],
    factsUsed: (output?.factsUsed as string[] | undefined) ?? [],
    output,
    approach: g.approach,
    prompt: `${g.promptId}@v${g.promptVersion}`,
    provider: g.provider,
    model: g.model,
    costEstimateUsd: g.costEstimateUsd === null ? null : Number(g.costEstimateUsd),
    latencyMs: g.latencyMs,
    errorCode: g.errorCode,
    discardReason: g.discardReason,
    rating: g.rating,
    feedback: g.feedback,
    requestedBy: g.requestedBy,
    approvedBy: g.approvedBy,
    approvedAt: g.approvedAt,
    createdAt: g.createdAt,
    /** Envio em andamento ou feito a partir deste rascunho. */
    activeMessage: g.messages[0] ?? null,
  };
}

export type GenerationView = ReturnType<typeof describeGeneration>;
