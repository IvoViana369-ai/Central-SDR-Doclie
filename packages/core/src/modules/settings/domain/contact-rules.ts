import { z } from 'zod';

/**
 * Regras de contato do modo assistido (docs/SDR-FLOW.md §4.2, §5 e §6),
 * editáveis pelo ADMIN e guardadas em `app_settings`. Sem linha gravada, valem
 * os padrões abaixo.
 */

export const CONTACT_RULES_KEY = 'contact.rules';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM.');

export const contactRulesSchema = z
  .object({
    /** Janela de contato na hora local do lead. */
    windowStart: hhmm,
    /** "24:00" estende a janela até o fim do dia. */
    windowEnd: z.union([hhmm, z.literal('24:00')]),
    /** Dias da semana com contato (0 = domingo … 6 = sábado). */
    workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    /** Intervalo mínimo entre contatos ao mesmo lead (respostas a ele não contam). */
    minHoursBetweenContacts: z.number().int().min(0).max(720),
    /** Primeiros contatos por SDR por dia. */
    maxFirstContactsPerDay: z.number().int().min(1).max(500),
    /** Lead sem atividade há N dias, em etapa aberta e sem tarefa, é "esquecido". */
    forgottenAfterDays: z.number().int().min(1).max(90),
    /** Resposta recebida sem ação do SDR por mais de N horas úteis fica em destaque. */
    replySlaHours: z.number().int().min(1).max(72),
    /** Dias úteis para o comercial aceitar uma transferência. */
    handoffAcceptBusinessDays: z.number().int().min(1).max(10),
    /** "Novos leads" na fila: atribuídos ao SDR nos últimos N dias. */
    newLeadDays: z.number().int().min(1).max(60),
    /** Expressões de opt-out procuradas nas respostas (sem acento e sem caixa). */
    optOutKeywords: z.array(z.string().trim().min(2).max(60)).min(1).max(100),
  })
  .refine((r) => r.windowStart < r.windowEnd, {
    message: 'O fim da janela deve ser depois do início.',
    path: ['windowEnd'],
  });

export type ContactRules = z.infer<typeof contactRulesSchema>;

export const DEFAULT_OPT_OUT_KEYWORDS = [
  'sair',
  'parar',
  'pare',
  'stop',
  'descadastrar',
  'descadastre',
  'remover',
  'nao quero receber',
  'nao quero mais receber',
  'nao me mande',
  'nao mande mais',
  'nao envie mais',
  'nao entre mais em contato',
  'nao me procure',
  'remova meu numero',
  'remova meu contato',
  'tire meu numero',
  'me tire da lista',
  'me remova',
] as const;

export const DEFAULT_CONTACT_RULES: ContactRules = {
  windowStart: '08:00',
  windowEnd: '18:00',
  workDays: [1, 2, 3, 4, 5],
  minHoursBetweenContacts: 48,
  maxFirstContactsPerDay: 40,
  forgottenAfterDays: 7,
  replySlaHours: 2,
  handoffAcceptBusinessDays: 1,
  newLeadDays: 7,
  optOutKeywords: [...DEFAULT_OPT_OUT_KEYWORDS],
};

/**
 * Lê o valor gravado; campo ausente ou inválido volta ao padrão (uma
 * configuração antiga nunca derruba o fluxo de contato).
 */
export function resolveContactRules(stored: unknown): ContactRules {
  const merged = { ...DEFAULT_CONTACT_RULES, ...(isRecord(stored) ? stored : {}) };
  const parsed = contactRulesSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_CONTACT_RULES;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
