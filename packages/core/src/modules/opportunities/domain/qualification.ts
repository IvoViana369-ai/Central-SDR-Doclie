import { z } from 'zod';

/**
 * Checklist de qualificação da transferência ao Comercial (docs/SDR-FLOW.md
 * §8.1; proposta a validar com o Comercial). O nome do decisor é dado pessoal:
 * apagado na anonimização do lead.
 */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .nullish()
    .transform((v) => v || null);
const required = (label: string, max: number) =>
  z.string().trim().min(2, `Informe ${label}.`).max(max, `Máximo de ${max} caracteres.`);

export const qualificationSchema = z.object({
  /** Obrigatório: decisor identificado (nome e função). */
  decisionMaker: required('o decisor (nome e função)', 160),
  /** Obrigatório: interesse declarado na parceria ou no serviço. */
  interest: required('o interesse declarado', 500),
  /** Obrigatório: melhor canal e horário para o comercial. */
  bestChannelAndTime: required('o melhor canal e horário', 200),
  /** Recomendado: porte (nº aproximado de clientes empresariais do escritório). */
  clientCount: z.number().int().min(0).max(100_000).nullish(),
  /** Recomendado: já trabalha com certificado digital? Com qual fornecedor? */
  certificateProvider: text(200),
  /** Recomendado: principais objeções levantadas. */
  objections: text(500),
  /** Opcional: reunião agendada. */
  meetingAt: z.coerce.date().nullish(),
});

export type Qualification = z.infer<typeof qualificationSchema>;

export const QUALIFICATION_LABELS: Record<keyof Qualification, string> = {
  decisionMaker: 'Decisor (nome e função)',
  interest: 'Interesse declarado',
  bestChannelAndTime: 'Melhor canal e horário',
  clientCount: 'Clientes empresariais (aprox.)',
  certificateProvider: 'Certificado digital (fornecedor atual)',
  objections: 'Objeções levantadas',
  meetingAt: 'Reunião agendada',
};

export const OPPORTUNITY_STATUS_LABELS = {
  OPEN: 'Aberta',
  WON: 'Ganha',
  LOST: 'Perdida',
} as const;

export const CONVERSION_TYPE_LABELS = {
  PARTNER: 'Parceiro',
  CUSTOMER: 'Cliente',
} as const;
