import type {
  ContactPointType,
  LeadStatus,
  LegalBasis,
  OptInStatus,
  PhoneKind,
  SuppressionReason,
  SuppressionScope,
  WhatsappStatus,
} from '@docline/db';

/**
 * Gate de contactabilidade (docs/ARCHITECTURE.md §7.3, docs/SDR-FLOW.md §9):
 * "posso contatar este lead neste canal, deste modo, agora?", com motivos
 * legíveis. Encontrar um telefone não significa autorização: telefone
 * identificado ≠ contato permitido.
 *
 * Lista Não Contatar, base legal, contato ativo do canal e situação do lead.
 * No modo API do WhatsApp (Fase 7), só números com opt-in registrado ou com a
 * janela de atendimento aberta pelo próprio contato. Janela de horário e
 * limites de frequência, que passam com o tempo, ficam em `contact-timing.ts`
 * e são somados em `infra/gate.ts`.
 */

export const GATE_CHANNELS = ['WHATSAPP', 'PHONE', 'EMAIL', 'INSTAGRAM'] as const;
export type GateChannel = (typeof GATE_CHANNELS)[number];
export type ContactMode = 'ASSISTED' | 'API';

export const GATE_CHANNEL_LABELS: Record<GateChannel, string> = {
  WHATSAPP: 'WhatsApp',
  PHONE: 'Ligação',
  EMAIL: 'E-mail',
  INSTAGRAM: 'Instagram',
};

export interface GateSuppression {
  reason: SuppressionReason;
  scope: SuppressionScope;
  createdAt: Date;
}

export interface GateContactPoint {
  id: string;
  type: ContactPointType;
  phoneKind: PhoneKind | null;
  whatsappStatus: WhatsappStatus;
  suppressions: GateSuppression[];
  /** Opt-in do WhatsApp registrado para este número (Fase 7). */
  whatsappOptIn?: boolean;
  /** Janela de atendimento do WhatsApp aberta por este número (até 24 h da última mensagem dele). */
  serviceWindowOpen?: boolean;
}

export interface GateInput {
  leadStatus: LeadStatus;
  /** Base legal para todos os canais. */
  legalBasis: LegalBasis | null;
  /** Permissões específicas por canal (sobrepõem a geral). */
  channelPermissions: { channel: GateChannel; legalBasis: LegalBasis; optInStatus: OptInStatus }[];
  organizationSuppressions: GateSuppression[];
  /** Somente pontos de contato ativos. */
  contactPoints: GateContactPoint[];
}

export interface GateResult {
  channel: GateChannel;
  allowed: boolean;
  reasons: string[];
  /** Contatos do canal que podem ser usados (sem supressão). */
  usableContactPointIds: string[];
  /**
   * Só com bloqueio que passa com o tempo (janela, intervalo entre contatos,
   * limite diário): a partir de quando o contato fica liberado.
   */
  availableAt?: Date | null;
}

const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  OPT_OUT: 'pediu para não ser contatado',
  DATA_SUBJECT_REQUEST: 'solicitação do titular',
  COMPLAINT: 'reclamação',
  LEGAL: 'determinação legal',
  INVALID_CONTACT: 'contato inválido',
  INTERNAL_DECISION: 'decisão interna',
};

const LEAD_STATUS_REASONS: Partial<Record<LeadStatus, string>> = {
  ARCHIVED: 'Lead arquivado.',
  MERGED: 'Lead mesclado em outro.',
  ANONYMIZED: 'Lead anonimizado.',
};

const formatDate = (date: Date) =>
  date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function appliesTo(suppression: GateSuppression, channel: GateChannel): boolean {
  return suppression.scope === 'ALL_CHANNELS' || suppression.scope === channel;
}

/** Telefone que serve para WhatsApp: celular não marcado como "não usa", ou fixo marcado como provável/confirmado. */
export function isWhatsappCandidate(
  cp: Pick<GateContactPoint, 'type' | 'phoneKind' | 'whatsappStatus'>,
): boolean {
  return (
    cp.type === 'PHONE' &&
    cp.whatsappStatus !== 'NOT_ON_WHATSAPP' &&
    (cp.phoneKind === 'MOBILE' ||
      cp.whatsappStatus === 'PROBABLE' ||
      cp.whatsappStatus === 'CONFIRMED')
  );
}

/** Contatos que servem para o canal. */
function candidatesFor(channel: GateChannel, points: GateContactPoint[]): GateContactPoint[] {
  switch (channel) {
    case 'WHATSAPP':
      return points.filter(isWhatsappCandidate);
    case 'PHONE':
      return points.filter((cp) => cp.type === 'PHONE');
    case 'EMAIL':
      return points.filter((cp) => cp.type === 'EMAIL');
    case 'INSTAGRAM':
      return points.filter((cp) => cp.type === 'INSTAGRAM');
  }
}

const MISSING_CONTACT: Record<GateChannel, string> = {
  WHATSAPP: 'Nenhum celular com WhatsApp cadastrado.',
  PHONE: 'Nenhum telefone cadastrado.',
  EMAIL: 'Nenhum e-mail cadastrado.',
  INSTAGRAM: 'Nenhum Instagram cadastrado.',
};

export function evaluateChannel(
  input: GateInput,
  channel: GateChannel,
  mode: ContactMode = 'ASSISTED',
): GateResult {
  const reasons: string[] = [];

  const statusReason = LEAD_STATUS_REASONS[input.leadStatus];
  if (statusReason) reasons.push(statusReason);

  const organization = input.organizationSuppressions.find((s) => appliesTo(s, channel));
  if (organization) {
    // O lead inteiro está na lista: base legal e contatos deixam de importar
    // e só repetiriam o bloqueio.
    reasons.push(
      `Lead na Lista Não Contatar desde ${formatDate(organization.createdAt)} (${SUPPRESSION_REASON_LABELS[organization.reason]}).`,
    );
    return { channel, allowed: false, reasons, usableContactPointIds: [] };
  }

  const specific = input.channelPermissions.find((p) => p.channel === channel);
  const legalBasis = specific?.legalBasis ?? input.legalBasis;
  if (legalBasis === null || legalBasis === 'NOT_ASSESSED') {
    reasons.push('Sem base legal registrada para este canal.');
  }

  const candidates = candidatesFor(channel, input.contactPoints);
  let usable = candidates.filter((cp) => !cp.suppressions.some((s) => appliesTo(s, channel)));
  if (candidates.length === 0) {
    reasons.push(MISSING_CONTACT[channel]);
  } else if (usable.length === 0) {
    const first = candidates.flatMap((cp) => cp.suppressions).find((s) => appliesTo(s, channel))!;
    reasons.push(
      `Contato na Lista Não Contatar desde ${formatDate(first.createdAt)} (${SUPPRESSION_REASON_LABELS[first.reason]}).`,
    );
  } else if (mode === 'API' && channel === 'WHATSAPP') {
    // A Meta exige permissão do próprio número (ou a conversa aberta por ele).
    usable = usable.filter((cp) => cp.whatsappOptIn || cp.serviceWindowOpen);
    if (usable.length === 0) {
      reasons.push(
        'Nenhum número com opt-in registrado nem conversa aberta pelo contato nas últimas 24 h (exigido para enviar pela API do WhatsApp).',
      );
    }
  } else if (mode === 'API' && channel === 'INSTAGRAM') {
    // A API do Instagram só responde a quem escreveu, até 24 h depois (Fase 8).
    usable = usable.filter((cp) => cp.serviceWindowOpen);
    if (usable.length === 0) {
      reasons.push(
        'O contato não escreveu para a Docline no Instagram nas últimas 24 h: pela API só dá para responder (o primeiro contato é pelo app).',
      );
    }
  }

  return {
    channel,
    allowed: reasons.length === 0,
    reasons,
    usableContactPointIds: reasons.length === 0 ? usable.map((cp) => cp.id) : [],
  };
}

export function evaluateAllChannels(input: GateInput, mode: ContactMode = 'ASSISTED') {
  return GATE_CHANNELS.map((channel) => evaluateChannel(input, channel, mode));
}
