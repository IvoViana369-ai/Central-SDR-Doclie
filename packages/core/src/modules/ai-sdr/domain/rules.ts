import { z } from 'zod';
import { OUTREACH_KINDS, type OutreachKind } from './kinds';

/**
 * Regras dos guardrails da IA (docs/AI-SDR.md §7 e §9.2), editáveis pelo ADMIN
 * e guardadas em `app_settings`. Sem linha gravada, valem os padrões abaixo.
 * Cota diária e orçamento mensal vêm do ambiente (AI_MAX_GENERATIONS_PER_USER_PER_DAY,
 * AI_MONTHLY_BUDGET_USD), porque são controle de custo da operação.
 */

export const AI_RULES_KEY = 'ai.rules';

const kindRecord = <T extends z.ZodType>(value: T) =>
  z.object(Object.fromEntries(OUTREACH_KINDS.map((k) => [k, value])) as Record<OutreachKind, T>);

export const aiRulesSchema = z.object({
  /** Limite de caracteres por tipo de mensagem (aviso se passar). */
  maxChars: kindRecord(z.number().int().min(80).max(2000)),
  /** Tipos em que a mensagem precisa oferecer a opção de não receber mais mensagens. */
  optOutRequiredKinds: z.array(z.enum(OUTREACH_KINDS)).max(OUTREACH_KINDS.length),
  /** Frase sugerida quando a opção de opt-out falta. */
  optOutLine: z.string().trim().min(10).max(160),
  /** Termos que bloqueiam a aprovação sem edição (sem acento e sem caixa). */
  forbiddenTerms: z.array(z.string().trim().min(2).max(60)).max(200),
  /** Mínimo de referências concretas ao lead para não ser "mensagem genérica". */
  minPersonalization: z.number().int().min(0).max(5),
  /** Similaridade com mensagens recentes a outros leads que indica envio em massa. */
  massSimilarity: z.number().min(0.5).max(1),
});

export type AiRules = z.infer<typeof aiRulesSchema>;

export const DEFAULT_FORBIDDEN_TERMS = [
  'gratis',
  'gratuito',
  'promocao imperdivel',
  'imperdivel',
  'ultima chance',
  'oferta exclusiva',
  'sem compromisso nenhum',
  'garantido',
  'garantia de',
  'desconto de',
  'urgente',
] as const;

export const DEFAULT_AI_RULES: AiRules = {
  maxChars: {
    FIRST_CONTACT: 450,
    FOLLOW_UP_1: 300,
    FOLLOW_UP_2: 350,
    FOLLOW_UP_3: 250,
    INTERESTED_REPLY: 600,
    OBJECTION_REPLY: 600,
    SCHEDULING: 400,
    REACTIVATION: 400,
  },
  optOutRequiredKinds: ['FIRST_CONTACT', 'FOLLOW_UP_3', 'REACTIVATION'],
  optOutLine: 'Se preferir não receber mensagens, é só me avisar.',
  forbiddenTerms: [...DEFAULT_FORBIDDEN_TERMS],
  minPersonalization: 2,
  massSimilarity: 0.9,
};

/**
 * Lê o valor gravado; campo ausente ou inválido volta ao padrão (uma
 * configuração antiga nunca impede a geração).
 */
export function resolveAiRules(stored: unknown): AiRules {
  const record = isRecord(stored) ? stored : {};
  const merged = {
    ...DEFAULT_AI_RULES,
    ...record,
    maxChars: {
      ...DEFAULT_AI_RULES.maxChars,
      ...(isRecord(record.maxChars) ? record.maxChars : {}),
    },
  };
  const parsed = aiRulesSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_AI_RULES;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
