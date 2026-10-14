import type { ImportMatchStatus } from '@docline/db';

/**
 * Rótulos da Prospecção e da base aberta do CNPJ, sem I/O (seguros para a
 * interface).
 */

export const CNAE_LABELS: Record<string, string> = {
  '6920601': 'Contabilidade',
  '6920602': 'Consultoria e auditoria contábil e tributária',
};

/** "6920601" → "6920-6/01". */
export function formatCnae(code: string): string {
  return /^\d{7}$/.test(code) ? `${code.slice(0, 4)}-${code[4]}/${code.slice(5)}` : code;
}

/** Comparação com a base, como na importação ("repetido" é dentro da própria busca). */
export const PROSPECTING_MATCH_LABELS: Record<ImportMatchStatus, string> = {
  NEW: 'Novo',
  EXISTING: 'Já existe',
  POSSIBLE_DUPLICATE: 'Possível duplicado',
  DUPLICATE_IN_FILE: 'Repetido na busca',
  SUPPRESSED: 'Na Lista Não Contatar',
  INVALID: 'Inválido',
};

export const PROSPECTING_DECISION_LABELS = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
} as const;

export const REGISTRY_INGESTION_STATUS_LABELS = {
  RUNNING: 'Em andamento',
  SUCCEEDED: 'Concluída',
  FAILED: 'Falhou',
} as const;

/** O que o código gravado em `registry_ingestions.error` quer dizer. */
export const REGISTRY_ERROR_LABELS: Record<string, string> = {
  NOT_PUBLISHED: 'Mês ainda não publicado por completo pela Receita.',
  UNAVAILABLE: 'Servidor da Receita fora do ar ou download interrompido (tenta de novo).',
  INVALID_FILE: 'Arquivo fora do formato esperado ou corrompido.',
  TOO_LARGE: 'Arquivo maior que o limite de segurança.',
  STALLED: 'Carga parada por mais de 72 horas.',
  DISABLED: 'Base aberta desligada no meio da carga.',
  UNEXPECTED: 'Erro inesperado (veja os logs do worker).',
};

/** Campos que o "Completar com dados abertos" preenche. */
export const REGISTRY_FIELD_LABELS: Record<string, string> = {
  companyName: 'razão social',
  tradeName: 'nome fantasia',
  municipalityCode: 'cidade',
  postalCode: 'CEP',
  addressLine: 'endereço',
  addressNumber: 'número',
  addressComplement: 'complemento',
  neighborhood: 'bairro',
  segmentId: 'segmento',
  contactPoints: 'contatos',
  cnpj: 'CNPJ',
};
