/**
 * Minha Fila SDR (docs/SDR-FLOW.md §5): seções na ordem padrão e prioridade de
 * cada item. A prioridade é calculada na leitura, para não ficar desatualizada.
 */

export const QUEUE_SECTIONS = [
  { key: 'REPLIES', label: 'Respostas aguardando ação', weight: 100 },
  { key: 'OVERDUE', label: 'Follow-ups atrasados', weight: 80 },
  { key: 'PENDING_CONFIRMATION', label: 'Envios a confirmar', weight: 70 },
  { key: 'TODAY_FIRST_CONTACT', label: 'Contatos de hoje', weight: 60 },
  { key: 'TODAY_FOLLOW_UP', label: 'Follow-ups de hoje', weight: 55 },
  { key: 'HOT_LEADS', label: 'Leads quentes', weight: 40 },
  { key: 'NEW_LEADS', label: 'Novos leads', weight: 30 },
  { key: 'FORGOTTEN', label: 'Esquecidos', weight: 20 },
  { key: 'AWAITING_REPLY', label: 'Aguardando resposta', weight: 10 },
  { key: 'OPEN_OPPORTUNITIES', label: 'Oportunidades abertas', weight: 5 },
] as const;

export type QueueSectionKey = (typeof QUEUE_SECTIONS)[number]['key'];

const WEIGHTS = Object.fromEntries(QUEUE_SECTIONS.map((s) => [s.key, s.weight])) as Record<
  QueueSectionKey,
  number
>;

const DAY_MS = 86_400_000;

/**
 * prioridade = peso da seção + score × 0,5 + min(dias de atraso, 10) × 5
 *            + (resposta pendente ? 40 : 0)
 */
export function queuePriority(input: {
  section: QueueSectionKey;
  score: number | null;
  dueAt?: Date | null;
  now: Date;
  replyPending?: boolean;
}): number {
  const daysOverdue =
    input.dueAt && input.dueAt < input.now
      ? Math.floor((input.now.getTime() - input.dueAt.getTime()) / DAY_MS)
      : 0;
  return Math.round(
    WEIGHTS[input.section] +
      (input.score ?? 0) * 0.5 +
      Math.min(daysOverdue, 10) * 5 +
      (input.replyPending ? 40 : 0),
  );
}

/** Tipos de tarefa e seus rótulos. */
export const TASK_TYPE_LABELS = {
  FIRST_CONTACT: 'Primeiro contato',
  FOLLOW_UP: 'Follow-up',
  REPLY_NEEDED: 'Responder',
  CALL: 'Ligação',
  MEETING: 'Reunião',
  HANDOFF_REVIEW: 'Aceitar transferência',
  CUSTOM: 'Tarefa',
} as const;

export const TASK_STATUS_LABELS = {
  OPEN: 'Aberta',
  DONE: 'Concluída',
  CANCELED: 'Cancelada',
  SKIPPED: 'Pulada',
} as const;

export const ACTIVITY_TYPE_LABELS = {
  CALL: 'Ligação',
  MEETING: 'Reunião',
  VISIT: 'Visita',
  EMAIL_EXTERNAL: 'E-mail (fora do sistema)',
  OTHER: 'Outro',
} as const;

export const ACTIVITY_OUTCOME_LABELS = {
  CONNECTED: 'Atendeu',
  NO_ANSWER: 'Não atendeu',
  BUSY: 'Ocupado',
  WRONG_NUMBER: 'Número errado',
  VOICEMAIL: 'Caixa postal',
  HELD: 'Realizada',
  NO_SHOW: 'Não compareceu',
} as const;

/** Resultados de atividade que contam como contato feito (atualizam "último contato"). */
export const CONTACT_OUTCOMES = ['CONNECTED', 'HELD'] as const;
