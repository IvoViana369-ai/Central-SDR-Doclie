import type { DuplicatePolicy, ImportMatchStatus, ImportRowDecision } from '@docline/db';

/** Motivo do casamento de uma linha (valores sempre mascarados). */
export interface MatchReason {
  rule:
    'CNPJ' | 'CNPJ_ROOT' | 'PHONE' | 'EMAIL' | 'INSTAGRAM' | 'NAME_CITY' | 'IN_FILE' | 'SUPPRESSED';
  detail: string;
}

export const MATCH_STATUS_LABELS: Record<ImportMatchStatus, string> = {
  NEW: 'Novo',
  EXISTING: 'Já existe',
  POSSIBLE_DUPLICATE: 'Possível duplicado',
  DUPLICATE_IN_FILE: 'Repetido no arquivo',
  SUPPRESSED: 'Na Lista Não Contatar',
  INVALID: 'Inválido',
};

export const DECISION_LABELS: Record<ImportRowDecision, string> = {
  IMPORT: 'Criar lead',
  SKIP: 'Pular',
  LINK_EXISTING: 'Só registrar a origem no lead existente',
  UPDATE_EXISTING: 'Completar campos vazios do existente',
};

export const POLICY_LABELS: Record<DuplicatePolicy, string> = {
  CREATE_AND_FLAG: 'Criar e sinalizar possíveis duplicados',
  SKIP: 'Pular duplicados',
  UPDATE_EMPTY_FIELDS: 'Completar campos vazios do existente',
};

/**
 * Decisão inicial de cada linha, pela política do lote. Na dúvida (possível
 * duplicado), nada é alterado no lead existente: cria e sinaliza para a
 * revisão, ou pula.
 */
export function defaultDecision(
  status: ImportMatchStatus,
  policy: DuplicatePolicy,
): ImportRowDecision {
  switch (status) {
    case 'NEW':
      return 'IMPORT';
    case 'EXISTING':
      return policy === 'SKIP'
        ? 'SKIP'
        : policy === 'UPDATE_EMPTY_FIELDS'
          ? 'UPDATE_EXISTING'
          : 'LINK_EXISTING';
    case 'POSSIBLE_DUPLICATE':
      return policy === 'SKIP' ? 'SKIP' : 'IMPORT';
    case 'DUPLICATE_IN_FILE':
    case 'SUPPRESSED':
    case 'INVALID':
      return 'SKIP';
  }
}

/**
 * Decisões que o usuário pode escolher. Linha inválida ou com contato na
 * Lista Não Contatar não vira lead novo; CNPJ já cadastrado também não.
 */
export function allowedDecisions(
  status: ImportMatchStatus,
  options: { hasMatch: boolean; matchedByCnpj: boolean },
): ImportRowDecision[] {
  const onExisting: ImportRowDecision[] = options.hasMatch
    ? ['LINK_EXISTING', 'UPDATE_EXISTING']
    : [];
  switch (status) {
    case 'NEW':
      return ['IMPORT', 'SKIP'];
    case 'EXISTING':
    case 'POSSIBLE_DUPLICATE':
      return [...(options.matchedByCnpj ? [] : (['IMPORT'] as const)), ...onExisting, 'SKIP'];
    case 'DUPLICATE_IN_FILE':
      return ['SKIP', 'IMPORT'];
    case 'SUPPRESSED':
      return [...(options.hasMatch ? (['LINK_EXISTING'] as const) : []), 'SKIP'];
    case 'INVALID':
      return ['SKIP'];
  }
}
