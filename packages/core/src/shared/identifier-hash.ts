import { createHmac } from 'node:crypto';

/** Identificadores que podem entrar na Lista Não Contatar (docs/LGPD.md §8). */
export type IdentifierType = 'PHONE' | 'EMAIL' | 'INSTAGRAM' | 'CNPJ';

/**
 * Hash de identificadores normalizados (HMAC-SHA256 com *pepper* secreto).
 *
 * Permite cruzar telefones, e-mails, Instagram e CNPJs com a Lista Não Contatar
 * sem guardar o valor em claro na lista, e o registro continua valendo depois
 * que o lead é anonimizado. O pepper (`SUPPRESSION_HASH_PEPPER`) não pode ser
 * trocado sem recalcular todos os hashes (docs/SECURITY.md §5).
 */
export interface IdentifierHasher {
  hash(type: IdentifierType, normalizedValue: string): string;
}

export function createIdentifierHasher(pepper: string): IdentifierHasher {
  if (pepper.length < 32) {
    throw new Error('O pepper dos identificadores deve ter ao menos 32 caracteres.');
  }
  return {
    hash: (type, normalizedValue) =>
      createHmac('sha256', pepper).update(`${type}:${normalizedValue}`, 'utf8').digest('hex'),
  };
}
