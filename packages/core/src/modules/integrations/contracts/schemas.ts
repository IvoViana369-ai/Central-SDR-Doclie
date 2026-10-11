import { z } from 'zod';
import { API_SCOPE_KEYS } from '../../identity';
import { SYSTEM_CODE_PATTERN } from '../domain/references';

const id = z.uuid('Identificador inválido.');

export const systemCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SYSTEM_CODE_PATTERN, 'Use letras maiúsculas, números e _ (ex.: DOCLINE_CRM).');

const uniqueList = <T extends z.ZodType<string>>(item: T, label: string) =>
  z
    .array(item)
    .min(1, `Escolha pelo menos um ${label}.`)
    .refine((list) => new Set(list).size === list.length, `Há ${label}s repetidos.`);

// -----------------------------------------------------------------------------
// Chaves de API (F12-01)
// -----------------------------------------------------------------------------

export const API_KEY_MAX_RATE = 6000;

export const createApiKeyInput = z.object({
  name: z.string().trim().min(2, 'Dê um nome à chave (ex.: CRM Docline).').max(80),
  scopes: uniqueList(z.enum(API_SCOPE_KEYS), 'escopo'),
  system: systemCode.nullish(),
  rateLimitPerMinute: z
    .number()
    .int()
    .min(1, 'O limite é de pelo menos 1 requisição por minuto.')
    .max(API_KEY_MAX_RATE, `O limite é de até ${API_KEY_MAX_RATE} requisições por minuto.`)
    .optional(),
  /** Validade opcional (fim do dia informado, no fuso da equipe, fica a cargo da tela). */
  expiresAt: z.coerce.date().nullish(),
});

export const revokeApiKeyInput = z.object({
  apiKeyId: id,
  reason: z.string().trim().min(3, 'Informe o motivo da revogação.').max(300),
});

export const listApiKeysInput = z.object({
  status: z.enum(['ACTIVE', 'ALL']).default('ALL'),
});
