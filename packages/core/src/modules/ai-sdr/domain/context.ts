import { AI_KIND_LABELS, KIND_GOALS, type OutreachKind } from './kinds';

/**
 * ContextBuilder (docs/AI-SDR.md §5): monta o contexto **mínimo** enviado à IA
 * a partir de uma lista branca de campos. Nada fora dela é enviado: sem CNPJ,
 * endereço, telefones, e-mails, observações internas, ids ou dados de outros
 * leads. O resultado é gravado em `ai_generations.input_snapshot`.
 */

/** Telefones, e-mails e links: nunca vão à IA e não podem sair numa mensagem gerada. */
export const CONTACT_DATA_PATTERNS = {
  email: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
  url: /\b(?:https?:\/\/|www\.)\S+|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:com|net|org|br|io|app|me|info|biz|co|site|online|store)\b(?:\/\S*)?/giu,
  // 8 dígitos ou mais seguidos (com espaço, ponto, hífen ou parênteses no meio).
  phone: /\+?\(?\d(?:[\s().-]*\d){7,}/g,
} as const;

/** Troca dados de contato por marcadores antes de enviar um texto à IA. */
export function redactContactData(text: string): string {
  return text
    .replace(CONTACT_DATA_PATTERNS.email, '[e-mail]')
    .replace(CONTACT_DATA_PATTERNS.url, '[link]')
    .replace(CONTACT_DATA_PATTERNS.phone, '[telefone]');
}

/** Interações recentes enviadas como histórico (as mais novas). */
export const HISTORY_LIMIT = 5;
/** Cada texto do histórico vai truncado. */
export const HISTORY_TEXT_MAX = 280;
export const SDR_INSTRUCTIONS_MAX = 500;

export interface LeadContextSource {
  displayName: string;
  companyName: string | null;
  leadTypeLabel: string;
  segmentName: string | null;
  city: string | null;
  uf: string | null;
  stageName: string | null;
  /** Origem principal: rótulo da fonte e, na indicação, quem indicou. */
  origin: { sourceLabel: string; referrerName: string | null } | null;
  /** Nome completo do responsável principal (só o primeiro nome é enviado). */
  contactPersonName: string | null;
  /** Mensagens do lead, da mais recente para a mais antiga. */
  interactions: {
    direction: 'OUTBOUND' | 'INBOUND';
    messageTypeLabel: string | null;
    at: Date;
    body: string | null;
  }[];
}

export interface OutreachRequestInput {
  kind: OutreachKind;
  channelLabel: string;
  sdrName: string;
  approach: { key: string; name: string; guidance: string | null } | null;
  sdrInstructions: string | null;
  maxChars: number;
  /** Frase de opt-out quando o tipo exige oferecer a saída; null quando não exige. */
  optOutLine: string | null;
  facts: { key: string; version: number }[];
}

export interface OutreachContext {
  request: {
    kind: OutreachKind;
    kindLabel: string;
    goal: string;
    channel: string;
    maxChars: number;
    optOutLine: string | null;
    sdrFirstName: string;
  };
  lead: {
    name: string;
    companyName: string | null;
    type: string;
    segment: string | null;
    city: string | null;
    uf: string | null;
    stage: string | null;
    origin: string | null;
    referredBy: string | null;
    contactFirstName: string | null;
  };
  history: { direction: 'OUTBOUND' | 'INBOUND'; type: string | null; date: string; text: string }[];
  approach: { key: string; name: string; guidance: string | null } | null;
  sdrInstructions: string | null;
  facts: { key: string; version: number }[];
  /** Avisos de contexto fraco, mostrados ao SDR junto com o rascunho. */
  warnings: string[];
}

export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Tipos que dependem de uma conversa anterior. */
const NEEDS_HISTORY: OutreachKind[] = [
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'FOLLOW_UP_3',
  'INTERESTED_REPLY',
  'OBJECTION_REPLY',
  'SCHEDULING',
];

export function buildOutreachContext(
  source: LeadContextSource,
  request: OutreachRequestInput,
): OutreachContext {
  const company =
    source.companyName && source.companyName !== source.displayName ? source.companyName : null;
  const history = source.interactions
    .filter((i) => i.body?.trim())
    .slice(0, HISTORY_LIMIT)
    .map((i) => ({
      direction: i.direction,
      type: i.messageTypeLabel,
      date: i.at.toISOString().slice(0, 10),
      text: truncate(redactContactData(i.body!.trim()), HISTORY_TEXT_MAX),
    }));
  const instructions = request.sdrInstructions?.trim()
    ? truncate(redactContactData(request.sdrInstructions.trim()), SDR_INSTRUCTIONS_MAX)
    : null;

  const warnings: string[] = [];
  const contactFirstName = firstName(source.contactPersonName);
  if (!source.city) warnings.push('Sem cidade: a personalização fica mais fraca.');
  if (!contactFirstName) warnings.push('Sem nome do responsável: a saudação será genérica.');
  if (NEEDS_HISTORY.includes(request.kind) && history.length === 0) {
    warnings.push('Sem histórico de conversa registrado para este tipo de mensagem.');
  }
  if (request.facts.length === 0) {
    warnings.push(
      'Base de conhecimento vazia: a mensagem não traz fatos sobre a Docline (cadastre em Configurações → IA).',
    );
  }

  return {
    request: {
      kind: request.kind,
      kindLabel: AI_KIND_LABELS[request.kind],
      goal: KIND_GOALS[request.kind],
      channel: request.channelLabel,
      maxChars: request.maxChars,
      optOutLine: request.optOutLine,
      sdrFirstName: firstName(request.sdrName) ?? request.sdrName,
    },
    lead: {
      name: source.displayName,
      companyName: company,
      type: source.leadTypeLabel,
      segment: source.segmentName,
      city: source.city,
      uf: source.uf,
      stage: source.stageName,
      origin: source.origin?.sourceLabel ?? null,
      referredBy: firstName(source.origin?.referrerName),
      contactFirstName,
    },
    history,
    approach: request.approach,
    sdrInstructions: instructions,
    facts: request.facts,
    warnings,
  };
}
