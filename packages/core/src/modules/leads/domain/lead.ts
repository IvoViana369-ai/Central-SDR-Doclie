import type {
  AssignmentStrategy,
  ContactPointStatus,
  ContactPointType,
  LeadStatus,
  LeadType,
  PhoneKind,
  WhatsappStatus,
} from '@docline/db';
import { cleanText, formatName, nameCore, toSearchKey } from '../../normalization';

/** Código legível do lead: 123 → "L-000123". */
export function formatLeadCode(code: number): string {
  return `L-${String(code).padStart(6, '0')}`;
}

/** "L-000123", "l123" ou "123" → 123. */
export function parseLeadCode(value: string): number | null {
  const match = /^\s*(?:l-?)?0*(\d{1,9})\s*$/i.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * Nome exibido (fantasia → razão social) e chaves de busca e comparação.
 * Texto todo em maiúsculas ou minúsculas ganha capitalização (M05).
 */
export function buildLeadNames(input: { companyName?: string | null; tradeName?: string | null }) {
  const companyName = input.companyName ? formatName(input.companyName) || null : null;
  const tradeName = input.tradeName ? formatName(input.tradeName) || null : null;
  const displayName = tradeName ?? companyName;
  if (!displayName) return null;
  return {
    companyName,
    tradeName,
    displayName,
    nameSearch: toSearchKey(displayName),
    nameCore: nameCore(displayName),
  };
}

/** Primeiro nome para saudações ("Maria Clara Souza" → "Maria"). */
export function firstNameOf(fullName: string): string {
  return cleanText(fullName).split(' ')[0] ?? '';
}

export const LEAD_TYPE_LABELS: Record<LeadType, string> = {
  ACCOUNTING_FIRM: 'Escritório de contabilidade',
  ACCOUNTANT: 'Contador(a)',
  REFERRAL_PARTNER: 'Parceiro indicador',
  COMPANY: 'Empresa',
  OTHER: 'Outro',
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  ACTIVE: 'Ativo',
  ARCHIVED: 'Arquivado',
  MERGED: 'Mesclado',
  ANONYMIZED: 'Anonimizado',
};

export const CONTACT_POINT_TYPE_LABELS: Record<ContactPointType, string> = {
  PHONE: 'Telefone',
  EMAIL: 'E-mail',
  INSTAGRAM: 'Instagram',
};

export const CONTACT_POINT_STATUS_LABELS: Record<ContactPointStatus, string> = {
  ACTIVE: 'Ativo',
  INVALID: 'Inválido',
  BOUNCED: 'Não entregue',
  WRONG_PERSON: 'Pessoa errada',
  REMOVED: 'Removido',
};

export const PHONE_KIND_LABELS: Record<PhoneKind, string> = {
  MOBILE: 'Celular',
  LANDLINE: 'Fixo',
  SERVICE: 'Serviço',
  UNKNOWN: 'Outro',
};

export const WHATSAPP_STATUS_LABELS: Record<WhatsappStatus, string> = {
  UNKNOWN: 'Não informado',
  PROBABLE: 'Provável (informado pela fonte)',
  CONFIRMED: 'Confirmado (houve conversa)',
  NOT_ON_WHATSAPP: 'Não usa WhatsApp',
};

export const ASSIGNMENT_STRATEGY_LABELS: Record<AssignmentStrategy, string> = {
  MANUAL: 'Atribuição manual',
  CLAIM: 'Puxado do pool',
  IMPORT: 'Importação',
  ROUND_ROBIN: 'Rodízio',
  TERRITORY: 'Território',
  PRIORITY: 'Prioridade',
  AVAILABILITY: 'Disponibilidade',
};
