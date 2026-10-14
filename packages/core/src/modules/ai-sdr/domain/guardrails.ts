import { toSearchKey } from '../../normalization';
import { CONTACT_DATA_PATTERNS, type OutreachContext } from './context';
import type { OutreachKind } from './kinds';
import type { AiRules } from './rules';
import { LOW_CONFIDENCE, type ReplyClassificationOutput } from './schemas';
import { textSimilarity } from './text-metrics';

/**
 * Guardrails determinísticos depois da geração (docs/AI-SDR.md §9.2). Rodam no
 * rascunho e de novo no texto editado: **bloqueante** impede aprovar até a
 * pessoa corrigir; **aviso** fica visível, mas não impede.
 */

export type GuardrailSeverity = 'BLOCKING' | 'WARNING';

export type GuardrailCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'FORBIDDEN_TERM'
  | 'CONTACT_DATA'
  | 'UNSUPPORTED_VALUE'
  | 'UNKNOWN_NAME'
  | 'GENERIC'
  | 'MASS_MESSAGE'
  | 'MISSING_OPT_OUT'
  | 'LOW_CONFIDENCE'
  | 'OPT_OUT_SIGNAL';

export interface GuardrailFlag {
  code: GuardrailCode;
  severity: GuardrailSeverity;
  message: string;
  /** O trecho que disparou (termo, nome, valor). */
  detail?: string;
  /** Correção sugerida (ex.: a frase de opt-out). */
  suggestion?: string;
}

export const hasBlocking = (flags: readonly GuardrailFlag[]) =>
  flags.some((f) => f.severity === 'BLOCKING');

const containsPhrase = (haystack: string, phrase: string) =>
  phrase.length > 0 && ` ${haystack} `.includes(` ${phrase} `);

/** Formas de oferecer a saída que contam como opt-out (sem acento e sem caixa). */
const OPT_OUT_OFFERS = [
  'nao receber',
  'nao quiser receber',
  'nao quiser mais',
  'nao queira receber',
  'nao deseja receber',
  'nao desejar receber',
  'parar de receber',
  'deixar de receber',
  'descadastrar',
  'descadastro',
  'sair da lista',
  'nao entro mais em contato',
  'nao te procuro mais',
  'nao incomodo mais',
];

/** Palavras com inicial maiúscula que não são nomes de pessoa, empresa ou lugar. */
const COMMON_CAPITALIZED = new Set(
  [
    'docline',
    'whatsapp',
    'instagram',
    'google',
    'linkedin',
    'brasil',
    'receita',
    'federal',
    'certificado',
    'certificados',
    'digital',
    'digitais',
    'contabilidade',
    'contador',
    'contadora',
    'escritorio',
    'parceria',
    'segunda',
    'terca',
    'quarta',
    'quinta',
    'sexta',
    'sabado',
    'domingo',
    'janeiro',
    'fevereiro',
    'marco',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
    'pix',
    'sr',
    'sra',
    'dr',
    'dra',
  ].map(toSearchKey),
);

/** Palavras genéricas em nomes de escritório: não contam como personalização. */
const GENERIC_NAME_WORDS = new Set(
  [
    'contabilidade',
    'contabil',
    'contabeis',
    'escritorio',
    'assessoria',
    'consultoria',
    'servicos',
    'associados',
    'ltda',
    'eireli',
    'me',
    'epp',
    'cia',
    'grupo',
    'empresa',
  ].map(toSearchKey),
);

/** Tipos em que a personalização é cobrada (as respostas seguem a conversa). */
const PERSONALIZED_KINDS: OutreachKind[] = [
  'FIRST_CONTACT',
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'FOLLOW_UP_3',
  'REACTIVATION',
];

export interface OutreachCheckInput {
  kind: OutreachKind;
  rules: AiRules;
  context: OutreachContext;
  /** Conteúdo dos fatos aprovados usados no pedido. */
  factTexts: string[];
  /** Mensagens recentes enviadas a outros leads (detecção de envio em massa). */
  recentOtherMessages: string[];
}

function significantTokens(value: string | null | undefined): string[] {
  return toSearchKey(value ?? '')
    .split(' ')
    .filter((t) => t.length >= 3 && !GENERIC_NAME_WORDS.has(t));
}

/** Nomes próprios (inicial maiúscula) fora do início de frase. */
function properNouns(text: string): string[] {
  const found: string[] = [];
  const re = /(^|[.!?\n]\s*|[^\p{L}\p{N}]+)(\p{Lu}[\p{Ll}]{2,}(?:[-'’]\p{L}+)?)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const before = match[1] ?? '';
    const sentenceStart = before === '' || /[.!?\n]\s*$/.test(before);
    if (!sentenceStart) found.push(match[2]!);
  }
  return found;
}

export function checkOutreachText(text: string, input: OutreachCheckInput): GuardrailFlag[] {
  const flags: GuardrailFlag[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return [{ code: 'EMPTY', severity: 'BLOCKING', message: 'A mensagem está vazia.' }];
  }
  const normalized = toSearchKey(trimmed);
  const { rules, context, kind } = input;

  const max = rules.maxChars[kind];
  if (trimmed.length > max) {
    flags.push({
      code: 'TOO_LONG',
      severity: 'WARNING',
      message: `Passa do limite de ${max} caracteres para ${context.request.kindLabel.toLowerCase()} (${trimmed.length}).`,
    });
  }

  for (const term of rules.forbiddenTerms) {
    if (containsPhrase(normalized, toSearchKey(term))) {
      flags.push({
        code: 'FORBIDDEN_TERM',
        severity: 'BLOCKING',
        message: `Termo não permitido: "${term}". Edite antes de aprovar.`,
        detail: term,
      });
    }
  }

  const contactKinds: [RegExp, string][] = [
    [CONTACT_DATA_PATTERNS.email, 'e-mail'],
    [CONTACT_DATA_PATTERNS.url, 'link'],
    [CONTACT_DATA_PATTERNS.phone, 'telefone ou número longo'],
  ];
  for (const [pattern, label] of contactKinds) {
    const found = trimmed.match(new RegExp(pattern.source, pattern.flags));
    if (found?.length) {
      flags.push({
        code: 'CONTACT_DATA',
        severity: 'BLOCKING',
        message: `A mensagem traz ${label} não previsto. Remova antes de aprovar.`,
        detail: found[0],
      });
    }
  }

  // Valores e percentuais só se estiverem nos fatos aprovados (sem promessas de preço).
  const factsKey = toSearchKey(input.factTexts.join(' '));
  for (const value of trimmed.match(/R\$\s?\d[\d.,]*|\d[\d.,]*\s?%/g) ?? []) {
    const digits = toSearchKey(value.replace(/R\$/g, ''));
    if (!containsPhrase(factsKey, digits)) {
      flags.push({
        code: 'UNSUPPORTED_VALUE',
        severity: 'BLOCKING',
        message: `Valor "${value}" não está nos fatos aprovados. Remova ou confirme com a Docline.`,
        detail: value,
      });
    }
  }

  // Nomes que não vêm do contexto: possível invenção.
  const known = new Set<string>([
    ...COMMON_CAPITALIZED,
    ...toSearchKey(
      [
        context.lead.name,
        context.lead.companyName,
        context.lead.segment,
        context.lead.city,
        context.lead.uf,
        context.lead.origin,
        context.lead.referredBy,
        context.lead.contactFirstName,
        context.lead.type,
        context.request.sdrFirstName,
        context.approach?.name,
        ...input.factTexts,
        ...context.history.map((h) => h.text),
      ]
        .filter(Boolean)
        .join(' '),
    ).split(' '),
  ]);
  const unknown = [...new Set(properNouns(trimmed))].filter((n) => !known.has(toSearchKey(n)));
  if (unknown.length > 0) {
    flags.push({
      code: 'UNKNOWN_NAME',
      severity: 'WARNING',
      message: `Nome que não está nos dados do lead: ${unknown.join(', ')}. Confira se não foi inventado.`,
      detail: unknown.join(', '),
    });
  }

  if (PERSONALIZED_KINDS.includes(kind)) {
    const references = [
      significantTokens(context.lead.name).some((t) => normalized.split(' ').includes(t)),
      containsPhrase(normalized, toSearchKey(context.lead.city ?? '')),
      containsPhrase(normalized, toSearchKey(context.lead.contactFirstName ?? '')),
      containsPhrase(normalized, toSearchKey(context.lead.referredBy ?? '')),
      containsPhrase(normalized, toSearchKey(context.lead.origin ?? '')),
      containsPhrase(normalized, toSearchKey(context.lead.segment ?? '')),
    ].filter(Boolean).length;
    if (references < rules.minPersonalization) {
      flags.push({
        code: 'GENERIC',
        severity: 'WARNING',
        message: `Mensagem genérica: só ${references} referência(s) concreta(s) ao lead.`,
      });
    }
  }

  const similar = Math.max(0, ...input.recentOtherMessages.map((m) => textSimilarity(m, trimmed)));
  if (similar >= rules.massSimilarity) {
    flags.push({
      code: 'MASS_MESSAGE',
      severity: 'WARNING',
      message: 'Muito parecida com mensagens recentes a outros leads: parece envio em massa.',
      detail: `${Math.round(similar * 100)}%`,
    });
  }

  if (
    rules.optOutRequiredKinds.includes(kind) &&
    !containsPhrase(normalized, toSearchKey(rules.optOutLine)) &&
    !OPT_OUT_OFFERS.some((offer) => normalized.includes(offer))
  ) {
    flags.push({
      code: 'MISSING_OPT_OUT',
      severity: 'WARNING',
      message: 'Falta oferecer uma forma simples de não receber mais mensagens.',
      suggestion: rules.optOutLine,
    });
  }

  return flags;
}

/** Avisos da sugestão de classificação: a decisão é sempre humana (§12). */
export function checkReplyClassification(output: ReplyClassificationOutput): GuardrailFlag[] {
  const flags: GuardrailFlag[] = [];
  if (output.label === 'OPT_OUT' || output.possibleOptOut) {
    flags.push({
      code: 'OPT_OUT_SIGNAL',
      severity: 'WARNING',
      message: 'Indício de pedido para não ser contatado: confirme antes de responder.',
    });
  }
  if (clampConfidence(output.confidence) < LOW_CONFIDENCE) {
    flags.push({
      code: 'LOW_CONFIDENCE',
      severity: 'WARNING',
      message: 'Confiança baixa: leia a resposta e classifique você mesmo.',
    });
  }
  return flags;
}

export const clampConfidence = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
