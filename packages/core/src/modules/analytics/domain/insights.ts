import { z } from 'zod';

/**
 * Insights da carteira (F11-04; docs/AI-SDR.md §13). Regra de ouro: **os
 * números vêm do banco; a IA só redige.** Cada fato tem um texto padrão
 * (determinístico); o texto da IA só é aceito se todo número nele existir no
 * fato e se não houver contato, link ou texto fora do tamanho.
 */

export const INSIGHT_TYPES = [
  'AWAITING_ACTION',
  'PENDING_ACCEPTANCE',
  'PRIORITY_TO_CONTACT',
  'FORGOTTEN_IN_CITY',
  'BEST_APPROACH',
  'TOP_POTENTIAL_CITY',
] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

export const INSIGHT_TYPE_LABELS: Record<InsightType, string> = {
  AWAITING_ACTION: 'Respostas esperando ação',
  PENDING_ACCEPTANCE: 'Transferências sem aceite',
  PRIORITY_TO_CONTACT: 'Prioritários sem contato',
  FORGOTTEN_IN_CITY: 'Sem follow-up',
  BEST_APPROACH: 'Abordagem que mais responde',
  TOP_POTENTIAL_CITY: 'Potencial por cidade',
};

export type InsightFact =
  | { type: 'AWAITING_ACTION'; count: number }
  | { type: 'PENDING_ACCEPTANCE'; count: number }
  | { type: 'PRIORITY_TO_CONTACT'; count: number }
  | { type: 'FORGOTTEN_IN_CITY'; count: number; city: string; cityCode: number; days: number }
  | {
      type: 'BEST_APPROACH';
      approachId: string;
      approach: string;
      rate: number;
      reference: number;
      trials: number;
      days: number;
    }
  | {
      type: 'TOP_POTENTIAL_CITY';
      city: string;
      cityCode: number;
      remaining: number;
      offices: number;
    };

/** Ordem de exibição: o que pede ação hoje vem antes. */
export const INSIGHT_PRIORITY: Record<InsightType, number> = {
  AWAITING_ACTION: 100,
  PENDING_ACCEPTANCE: 90,
  PRIORITY_TO_CONTACT: 80,
  FORGOTTEN_IN_CITY: 70,
  BEST_APPROACH: 50,
  TOP_POTENTIAL_CITY: 40,
};

const integer = new Intl.NumberFormat('pt-BR');

export function formatCount(value: number): string {
  return integer.format(value);
}

/** 0,235 → "23,5%"; 0,24 → "24%". */
export function formatPercent(rate: number): string {
  const value = Math.round(rate * 1000) / 10;
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

const plural = (count: number, one: string, many: string) =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

/** Texto padrão de cada fato (também o exemplo que vai para a IA). */
export function templateText(fact: InsightFact): string {
  switch (fact.type) {
    case 'AWAITING_ACTION':
      return fact.count === 1
        ? '1 lead respondeu e espera uma ação.'
        : `${formatCount(fact.count)} leads responderam e esperam uma ação.`;
    case 'PENDING_ACCEPTANCE':
      return fact.count === 1
        ? '1 transferência ao Comercial passou do prazo de aceite.'
        : `${formatCount(fact.count)} transferências ao Comercial passaram do prazo de aceite.`;
    case 'PRIORITY_TO_CONTACT':
      return `Hoje há ${plural(fact.count, 'escritório prioritário', 'escritórios prioritários')} ainda sem contato.`;
    case 'FORGOTTEN_IN_CITY':
      return `${plural(fact.count, 'lead', 'leads')} de ${fact.city} ${fact.count === 1 ? 'está' : 'estão'} sem follow-up há mais de ${fact.days} dias.`;
    case 'BEST_APPROACH':
      return `A abordagem "${fact.approach}" teve ${formatPercent(fact.rate)} de resposta, acima da média de ${formatPercent(fact.reference)} (${formatCount(fact.trials)} primeiros contatos em ${fact.days} dias).`;
    case 'TOP_POTENTIAL_CITY':
      return `${fact.city} tem ${plural(fact.remaining, 'escritório ativo', 'escritórios ativos')} que ainda não ${fact.remaining === 1 ? 'é lead' : 'são leads'} (de ${formatCount(fact.offices)} na base aberta do CNPJ).`;
  }
}

/**
 * Números que o texto pode citar: contagens e dias (`plain`) e taxas
 * (`percent`, com ou sem a casa decimal). Separados para "30%" não passar só
 * porque o período é de 30 dias.
 */
export interface AllowedNumbers {
  plain: number[];
  percent: number[];
}

const percentForms = (rate: number) => [Math.round(rate * 1000) / 10, Math.round(rate * 100)];

export function allowedNumbers(fact: InsightFact): AllowedNumbers {
  switch (fact.type) {
    case 'AWAITING_ACTION':
    case 'PENDING_ACCEPTANCE':
    case 'PRIORITY_TO_CONTACT':
      return { plain: [fact.count], percent: [] };
    case 'FORGOTTEN_IN_CITY':
      return { plain: [fact.count, fact.days], percent: [] };
    case 'BEST_APPROACH':
      return {
        plain: [fact.trials, fact.days],
        percent: [...percentForms(fact.rate), ...percentForms(fact.reference)],
      };
    case 'TOP_POTENTIAL_CITY':
      return { plain: [fact.remaining, fact.offices], percent: [] };
  }
}

/** "1.234" → 1234; "23,5%" → 23,5 (porcentagem). */
const NUMBER = /(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(\s?%)?/g;

export function numbersIn(text: string): { value: number; percent: boolean }[] {
  return [...text.matchAll(NUMBER)].map((m) => ({
    value: Number(m[1]!.replace(/\./g, '').replace(',', '.')),
    percent: m[2] !== undefined,
  }));
}

const FORBIDDEN = [/https?:\/\/|www\./i, /[\w.+-]+@[\w-]+\.[\w.]+/, /\(?\d{2}\)?\s?\d{4,5}-?\d{4}/];

export const INSIGHT_TEXT_MAX = 240;

export type InsightCheck = { ok: true } | { ok: false; reason: string };

/** Nomes citados pelo fato (cidade, abordagem): saem antes de conferir os números. */
function namesIn(fact: InsightFact): string[] {
  switch (fact.type) {
    case 'FORGOTTEN_IN_CITY':
    case 'TOP_POTENTIAL_CITY':
      return [fact.city];
    case 'BEST_APPROACH':
      return [fact.approach];
    default:
      return [];
  }
}

/** Confere o texto da IA contra o fato: números, tamanho e nada de contato ou link. */
export function checkInsightText(text: string, fact: InsightFact): InsightCheck {
  const trimmed = text.trim();
  if (trimmed.length < 10 || trimmed.length > INSIGHT_TEXT_MAX) {
    return { ok: false, reason: 'tamanho' };
  }
  if (FORBIDDEN.some((pattern) => pattern.test(trimmed))) {
    return { ok: false, reason: 'contato ou link' };
  }
  // Um nome com dígitos ("Abordagem 2") não conta como número citado.
  const withoutNames = namesIn(fact)
    .filter(Boolean)
    .reduce((acc, name) => acc.split(name).join(' '), trimmed);
  const allowed = allowedNumbers(fact);
  for (const { value, percent } of numbersIn(withoutNames)) {
    const pool = percent ? allowed.percent : allowed.plain;
    if (!pool.some((a) => Math.abs(a - value) < 0.05)) {
      return { ok: false, reason: `número fora dos fatos: ${value}${percent ? '%' : ''}` };
    }
  }
  return { ok: true };
}

/** O que a IA devolve: um texto por fato recebido, na mesma ordem. */
export const insightsOutputSchema = z.object({
  insights: z
    .array(
      z.object({
        type: z.enum(INSIGHT_TYPES),
        text: z.string().max(400),
      }),
    )
    .max(INSIGHT_TYPES.length),
});
export type InsightsOutput = z.infer<typeof insightsOutputSchema>;
