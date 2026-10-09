import type { EnrollmentStopReason } from '@docline/db';

/** Por que a cadência terminou (docs/SDR-FLOW.md §4.2). */
export const STOP_REASON_LABELS: Record<EnrollmentStopReason, string> = {
  REPLIED: 'O lead respondeu',
  OPTED_OUT: 'Opt-out',
  BLOCKED: 'Lead bloqueado na Lista Não Contatar',
  MANUAL: 'Encerrada pelo SDR',
  STAGE_CHANGED: 'Lead movido para fora da cadência',
  LEAD_ARCHIVED: 'Lead arquivado',
  LEAD_MERGED: 'Lead mesclado em outro',
  CONTACT_INVALID: 'Sem contato válido para o próximo passo',
};

/**
 * Etapas anteriores ao primeiro contato: o lead pode estar nelas com a
 * cadência ativa (o primeiro passo ainda não foi feito).
 */
export const PRE_CONTACT_STAGE_KEYS = ['NEW', 'TO_QUALIFY', 'QUALIFIED', 'AWAITING_OUTREACH'];

/** Etapas em que uma resposta recebida leva o lead a "Respondeu". */
export const PRE_REPLY_STAGE_KEYS = [
  ...PRE_CONTACT_STAGE_KEYS,
  'FIRST_CONTACT',
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'FOLLOW_UP_3',
  'NO_RESPONSE',
];
