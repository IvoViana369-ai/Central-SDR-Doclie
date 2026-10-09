import { z } from 'zod';
import { qualificationSchema } from '../domain/qualification';

const id = z.uuid({ message: 'Identificador inválido.' });

/** Transferir ao Comercial (M15): checklist, comercial responsável e notas. */
export const handoffInput = z.object({
  leadId: id,
  salesOwnerId: id,
  qualification: qualificationSchema,
  productInterest: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
  expectedValue: z.number().min(0).max(100_000_000).nullish(),
  notes: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => v || null),
});

export const opportunityIdInput = z.object({ opportunityId: id });

export const markWonInput = z.object({
  opportunityId: id,
  conversionType: z.enum(['PARTNER', 'CUSTOMER']),
  notes: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => v || null),
});

export const markLostInput = z.object({
  opportunityId: id,
  lossReasonId: id,
  notes: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => v || null),
});

export const listOpportunitiesInput = z.object({
  status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
});

export const leadOpportunitiesInput = z.object({ leadId: id });
