import { z } from 'zod';

/**
 * Saídas estruturadas da IA (docs/AI-SDR.md §6 e §12), validadas por Zod no
 * adaptador. Sem limites de tamanho no schema enviado ao modelo: tamanho e
 * conteúdo são conferidos depois, pelos guardrails, com mensagens claras.
 */

export const outreachMessageSchema = z.object({
  /** Texto pronto para enviar. */
  message: z.string(),
  /** Elementos concretos do lead usados na mensagem. */
  personalizationPoints: z.array(z.string()),
  /** Chaves dos fatos da Docline usados. */
  factsUsed: z.array(z.string()),
  /** Suposições que o SDR deve conferir antes de enviar. */
  assumptions: z.array(z.string()),
  /** Dados que melhorariam a mensagem. */
  missingInfo: z.array(z.string()),
  tone: z.enum(['formal', 'cordial', 'direto']),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type OutreachMessage = z.infer<typeof outreachMessageSchema>;

export const REPLY_LABELS = [
  'INTERESTED',
  'QUESTION',
  'OBJECTION',
  'NOT_INTERESTED',
  'OPT_OUT',
  'OUT_OF_OFFICE',
  'WRONG_CONTACT',
  'OTHER',
] as const;

export const replyClassificationSchema = z.object({
  label: z.enum(REPLY_LABELS),
  /** Confiança de 0 a 1 (valores fora do intervalo são limitados no uso). */
  confidence: z.number(),
  /** Justificativa curta, em português. */
  rationale: z.string(),
  /** Qualquer indício de pedido para não ser contatado. */
  possibleOptOut: z.boolean(),
  /** Próximo passo sugerido ao SDR (vazio se não houver). */
  suggestedNextStep: z.string(),
});

export type ReplyClassificationOutput = z.infer<typeof replyClassificationSchema>;

/** Abaixo disso, a sugestão vai para decisão humana com destaque (§12). */
export const LOW_CONFIDENCE = 0.6;
