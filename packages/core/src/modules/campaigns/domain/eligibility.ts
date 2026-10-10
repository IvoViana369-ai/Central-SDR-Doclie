import type { StageCategory } from '@docline/db';
import type { GateReasonCode } from '../../compliance';

/**
 * Elegibilidade de um lead para a campanha (F10-02), com motivos. Um lead é
 * apto quando o gate libera o canal da campanha (Lista Não Contatar, base
 * legal, contato do canal, situação do lead) e nada do que segue impede:
 * etapa encerrada, oportunidade aberta, outra cadência ou campanha em
 * andamento, contato recente demais (frequência) e responsável fora da
 * campanha. Janela de horário e limites diários não entram aqui: valem na
 * hora de cada contato, pelo gate de sempre.
 */

export const INELIGIBILITY_REASONS = [
  'LEAD_NOT_ACTIVE',
  'SUPPRESSED',
  'NO_LEGAL_BASIS',
  'NO_CHANNEL_CONTACT',
  'CONTACT_SUPPRESSED',
  'CLOSED_STAGE',
  'OPEN_OPPORTUNITY',
  'IN_CADENCE',
  'OTHER_CAMPAIGN',
  'RECENT_CONTACT',
  'OWNED_BY_OTHER',
] as const;
export type IneligibilityReason = (typeof INELIGIBILITY_REASONS)[number];

export const INELIGIBILITY_REASON_LABELS: Record<IneligibilityReason, string> = {
  LEAD_NOT_ACTIVE: 'Lead arquivado, mesclado ou anonimizado',
  SUPPRESSED: 'Na Lista Não Contatar',
  NO_LEGAL_BASIS: 'Sem base legal registrada',
  NO_CHANNEL_CONTACT: 'Sem contato no canal da campanha',
  CONTACT_SUPPRESSED: 'Contato do canal na Lista Não Contatar',
  CLOSED_STAGE: 'Lead ganho ou perdido',
  OPEN_OPPORTUNITY: 'Com oportunidade aberta (já com o Comercial)',
  IN_CADENCE: 'Já está numa cadência',
  OTHER_CAMPAIGN: 'Em outra campanha em andamento',
  RECENT_CONTACT: 'Contatado há pouco tempo (regra de frequência)',
  OWNED_BY_OTHER: 'Responsável fora da campanha',
};

/** Do código do gate para o motivo da campanha (o tempo não conta aqui). */
const FROM_GATE: Partial<Record<GateReasonCode, IneligibilityReason>> = {
  LEAD_NOT_ACTIVE: 'LEAD_NOT_ACTIVE',
  SUPPRESSED: 'SUPPRESSED',
  NO_LEGAL_BASIS: 'NO_LEGAL_BASIS',
  NO_CONTACT: 'NO_CHANNEL_CONTACT',
  CONTACT_SUPPRESSED: 'CONTACT_SUPPRESSED',
};

const DAY_MS = 86_400_000;

export interface EligibilityInput {
  /** Códigos do gate no canal da campanha (modo assistido). */
  gateCodes: GateReasonCode[];
  stageCategory: StageCategory | null;
  hasOpenOpportunity: boolean;
  hasOngoingEnrollment: boolean;
  inOtherCampaign: boolean;
  lastContactAt: Date | null;
  minDaysSinceLastContact: number;
  /** Responsável atual fora da lista de SDRs da campanha. */
  ownedByOther: boolean;
  now: Date;
}

/** Motivos de inelegibilidade, na ordem da lista (vazio = apto). */
export function evaluateEligibility(input: EligibilityInput): IneligibilityReason[] {
  const reasons = new Set<IneligibilityReason>();
  for (const code of input.gateCodes) {
    const reason = FROM_GATE[code];
    if (reason) reasons.add(reason);
  }
  if (input.stageCategory === 'WON' || input.stageCategory === 'LOST') {
    reasons.add('CLOSED_STAGE');
  }
  if (input.hasOpenOpportunity) reasons.add('OPEN_OPPORTUNITY');
  if (input.hasOngoingEnrollment) reasons.add('IN_CADENCE');
  if (input.inOtherCampaign) reasons.add('OTHER_CAMPAIGN');
  if (
    input.lastContactAt &&
    input.minDaysSinceLastContact > 0 &&
    input.now.getTime() - input.lastContactAt.getTime() < input.minDaysSinceLastContact * DAY_MS
  ) {
    reasons.add('RECENT_CONTACT');
  }
  if (input.ownedByOther) reasons.add('OWNED_BY_OTHER');
  return INELIGIBILITY_REASONS.filter((r) => reasons.has(r));
}

/** Contagem por motivo (um lead pode ter mais de um). */
export function countReasons(
  rows: { reasons: readonly string[] }[],
): Partial<Record<IneligibilityReason, number>> {
  const counts: Partial<Record<IneligibilityReason, number>> = {};
  for (const row of rows) {
    for (const reason of row.reasons) {
      if ((INELIGIBILITY_REASONS as readonly string[]).includes(reason)) {
        const key = reason as IneligibilityReason;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }
  return counts;
}
