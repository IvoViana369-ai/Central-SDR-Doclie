import type { LeadType } from '@docline/db';
import { z } from 'zod';

/**
 * Critérios do lead scoring (docs/DATABASE.md §8.2; F4-05). Cada critério é
 * registrado no código (chave, parâmetros validados e avaliação pura); o
 * modelo no banco só escolhe quais usar, com quais parâmetros e pesos.
 */

/** O que o score enxerga de um lead (montado pela infra a partir do banco). */
export interface ScoreFacts {
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  hasWebsite: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  hasCnpj: boolean;
  stateUf: string | null;
  inPriorityCity: boolean;
  leadType: LeadType;
  tagIds: string[];
  /** Já houve mensagem recebida do lead (Fase 5). */
  repliedBefore: boolean;
  /** Alguma resposta foi classificada como interesse (Fase 5). */
  showedInterest: boolean;
  /** Última publicação conhecida no Instagram (Fase 8). */
  instagramLastPostAt: Date | null;
  /** Avaliações no Google (depende de validação jurídica; Fase 9). */
  googleReviewsCount: number | null;
}

export interface Evaluation {
  matched: boolean;
  /** Explicação curta para a ficha do lead. */
  detail: string;
}

export interface CriterionDefinition<P = Record<string, unknown>> {
  key: string;
  label: string;
  /** Rótulo com os parâmetros (ex.: "Avaliações no Google ≥ 21"). */
  describe(params: P): string;
  params: z.ZodType<P>;
  evaluate(facts: ScoreFacts, params: P, now: Date): Evaluation;
  /** De onde vem o dado, quando ainda não existe no sistema. */
  availability?: string;
}

const LEAD_TYPES = [
  'ACCOUNTING_FIRM',
  'ACCOUNTANT',
  'REFERRAL_PARTNER',
  'COMPANY',
  'OTHER',
] as const;
const noParams = z.object({}).strict();

function flag(
  key: string,
  label: string,
  read: (f: ScoreFacts) => boolean,
  yes: string,
  no: string,
  availability?: string,
): CriterionDefinition<Record<string, never>> {
  return {
    key,
    label,
    describe: () => label,
    params: noParams as unknown as z.ZodType<Record<string, never>>,
    evaluate: (facts) =>
      read(facts) ? { matched: true, detail: yes } : { matched: false, detail: no },
    ...(availability ? { availability } : {}),
  };
}

const DAY_MS = 86_400_000;

export const CRITERIA = {
  has_whatsapp: flag(
    'has_whatsapp',
    'Tem WhatsApp',
    (f) => f.hasWhatsapp,
    'WhatsApp provável ou confirmado.',
    'Nenhum telefone marcado como WhatsApp.',
  ),
  has_instagram: flag(
    'has_instagram',
    'Tem Instagram',
    (f) => f.hasInstagram,
    'Instagram cadastrado.',
    'Sem Instagram.',
  ),
  has_website: flag(
    'has_website',
    'Tem site',
    (f) => f.hasWebsite,
    'Site cadastrado.',
    'Sem site.',
  ),
  has_email: flag(
    'has_email',
    'Tem e-mail',
    (f) => f.hasEmail,
    'E-mail cadastrado.',
    'Sem e-mail.',
  ),
  has_phone: flag(
    'has_phone',
    'Tem telefone',
    (f) => f.hasPhone,
    'Telefone cadastrado.',
    'Sem telefone.',
  ),
  has_cnpj: flag('has_cnpj', 'Tem CNPJ', (f) => f.hasCnpj, 'CNPJ cadastrado.', 'Sem CNPJ.'),
  in_priority_city: flag(
    'in_priority_city',
    'Em cidade prioritária',
    (f) => f.inPriorityCity,
    'A cidade está na lista de prioridades.',
    'A cidade não está na lista de prioridades.',
  ),
  replied_before: flag(
    'replied_before',
    'Já respondeu',
    (f) => f.repliedBefore,
    'Já houve resposta do lead.',
    'Ainda não houve resposta registrada.',
    'Respostas registradas a partir da Fase 5.',
  ),
  showed_interest: flag(
    'showed_interest',
    'Mostrou interesse',
    (f) => f.showedInterest,
    'Uma resposta foi classificada como interesse.',
    'Nenhuma resposta classificada como interesse.',
    'Classificação de respostas a partir da Fase 5.',
  ),
  in_state: {
    key: 'in_state',
    label: 'Em uma das UFs',
    describe: (p: { ufs: string[] }) => `Em ${p.ufs.join(', ')}`,
    params: z
      .object({
        ufs: z
          .array(z.string().regex(/^[A-Z]{2}$/))
          .min(1)
          .max(27),
      })
      .strict(),
    evaluate: (f: ScoreFacts, p: { ufs: string[] }) =>
      f.stateUf && p.ufs.includes(f.stateUf)
        ? { matched: true, detail: `UF ${f.stateUf}.` }
        : { matched: false, detail: f.stateUf ? `UF ${f.stateUf} fora da lista.` : 'Sem UF.' },
  } satisfies CriterionDefinition<{ ufs: string[] }>,
  lead_type_in: {
    key: 'lead_type_in',
    label: 'Tipo de lead',
    describe: (p: { types: LeadType[] }) => `Tipo: ${p.types.join(', ')}`,
    params: z.object({ types: z.array(z.enum(LEAD_TYPES)).min(1) }).strict(),
    evaluate: (f: ScoreFacts, p: { types: LeadType[] }) =>
      p.types.includes(f.leadType)
        ? { matched: true, detail: 'Tipo de lead na lista.' }
        : { matched: false, detail: 'Tipo de lead fora da lista.' },
  } satisfies CriterionDefinition<{ types: LeadType[] }>,
  has_tag: {
    key: 'has_tag',
    label: 'Tem a tag',
    describe: () => 'Tem a tag escolhida',
    params: z.object({ tagId: z.uuid() }).strict(),
    evaluate: (f: ScoreFacts, p: { tagId: string }) =>
      f.tagIds.includes(p.tagId)
        ? { matched: true, detail: 'Tag aplicada.' }
        : { matched: false, detail: 'Sem a tag.' },
  } satisfies CriterionDefinition<{ tagId: string }>,
  instagram_active: {
    key: 'instagram_active',
    label: 'Instagram ativo',
    describe: (p: { maxDaysSincePost: number }) =>
      `Publicou no Instagram nos últimos ${p.maxDaysSincePost} dias`,
    params: z.object({ maxDaysSincePost: z.number().int().min(1).max(365) }).strict(),
    evaluate: (f: ScoreFacts, p: { maxDaysSincePost: number }, now: Date) => {
      if (!f.instagramLastPostAt) {
        return { matched: false, detail: 'Sem dado de atividade do Instagram.' };
      }
      const days = Math.floor((now.getTime() - f.instagramLastPostAt.getTime()) / DAY_MS);
      return days <= p.maxDaysSincePost
        ? { matched: true, detail: `Última publicação há ${days} dias.` }
        : { matched: false, detail: `Última publicação há ${days} dias.` };
    },
    availability: 'Dado de atividade do Instagram a partir da Fase 8.',
  } satisfies CriterionDefinition<{ maxDaysSincePost: number }>,
  google_reviews_gte: {
    key: 'google_reviews_gte',
    label: 'Avaliações no Google',
    describe: (p: { min: number }) => `Avaliações no Google ≥ ${p.min}`,
    params: z.object({ min: z.number().int().min(1).max(100_000) }).strict(),
    evaluate: (f: ScoreFacts, p: { min: number }) =>
      f.googleReviewsCount === null
        ? { matched: false, detail: 'Sem dado de avaliações.' }
        : f.googleReviewsCount >= p.min
          ? { matched: true, detail: `${f.googleReviewsCount} avaliações.` }
          : { matched: false, detail: `${f.googleReviewsCount} avaliações.` },
    availability: 'Depende da validação jurídica do uso de dados do Google.',
  } satisfies CriterionDefinition<{ min: number }>,
} as const;

export type CriterionKey = keyof typeof CRITERIA;
export const CRITERION_KEYS = Object.keys(CRITERIA) as CriterionKey[];

export function criterionOf(key: string): CriterionDefinition<unknown> | null {
  return (CRITERIA as Record<string, CriterionDefinition<unknown>>)[key] ?? null;
}
