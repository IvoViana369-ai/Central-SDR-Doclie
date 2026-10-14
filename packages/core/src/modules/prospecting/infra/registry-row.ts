import type { DbTransaction, Prisma } from '@docline/db';
import { BusinessRuleError } from '../../../shared/errors';
import type { ImportContact, NormalizedImportRow } from '../../import';
import { buildLeadNames } from '../../leads';
import { formatName } from '../../normalization';
import { ACCOUNTING_CNAES, COMPANY_SIZE_LABELS } from '../domain/receita';

/** Origem dos leads e dos dados que vêm da base aberta (seed de referência). */
export const REGISTRY_SOURCE_KEY = 'CNPJ_OPEN_DATA';
/** Rótulo dos telefones e e-mails declarados à Receita. */
const CONTACT_LABEL = 'Cadastro na Receita';

export const REGISTRY_SELECT = {
  cnpj: true,
  cnpjRoot: true,
  isHeadOffice: true,
  companyName: true,
  tradeName: true,
  isIndividualEntrepreneur: true,
  companySize: true,
  cnaeMain: true,
  cnaesSecondary: true,
  openedAt: true,
  municipalityCode: true,
  cityName: true,
  uf: true,
  addressLine: true,
  addressNumber: true,
  addressComplement: true,
  neighborhood: true,
  postalCode: true,
  phone1: true,
  phone2: true,
  email: true,
  datasetReference: true,
  ingestedAt: true,
  municipality: { select: { name: true } },
} satisfies Prisma.RegistryCompanySelect;

export type RegistryRow = Prisma.RegistryCompanyGetPayload<{ select: typeof REGISTRY_SELECT }>;

/** Cidade para exibir: o nome do IBGE ou, sem correspondência, o da Receita. */
export function registryCity(c: RegistryRow): string | null {
  return c.municipality?.name ?? (c.cityName ? formatName(c.cityName) : null);
}

/** Dados do escritório para a tela (sem o que só serve à carga). */
export function registryView(c: RegistryRow) {
  return {
    cnpj: c.cnpj,
    isHeadOffice: c.isHeadOffice,
    companyName: c.companyName,
    tradeName: c.tradeName,
    isIndividualEntrepreneur: c.isIndividualEntrepreneur,
    companySize: c.companySize ? (COMPANY_SIZE_LABELS[c.companySize] ?? null) : null,
    cnaeMain: c.cnaeMain,
    cnaesSecondary: c.cnaesSecondary,
    openedAt: c.openedAt,
    municipalityCode: c.municipalityCode,
    city: registryCity(c),
    uf: c.uf,
    addressLine: c.addressLine,
    addressNumber: c.addressNumber,
    addressComplement: c.addressComplement,
    neighborhood: c.neighborhood,
    postalCode: c.postalCode,
    phones: [...new Set([c.phone1, c.phone2].filter((p): p is string => Boolean(p)))],
    email: c.email,
    datasetReference: c.datasetReference,
  };
}
export type RegistryView = ReturnType<typeof registryView>;

/**
 * Escritório da base aberta no formato de linha da importação, para casar com
 * a base (`matchRows`) e virar cadastro ou completar um lead. Telefones entram
 * sem presumir WhatsApp; nenhuma pessoa é criada (nem do nome de empresário
 * individual).
 */
export function registryToRow(
  c: RegistryRow,
  segmentId: string | null,
): NormalizedImportRow | null {
  const names = buildLeadNames({ companyName: c.companyName, tradeName: c.tradeName });
  if (!names) return null;
  const contacts: ImportContact[] = [
    ...new Set([c.phone1, c.phone2].filter((p): p is string => Boolean(p))),
  ].map((value) => ({ type: 'PHONE', value, isWhatsapp: false, label: CONTACT_LABEL }));
  if (c.email) {
    contacts.push({ type: 'EMAIL', value: c.email, isWhatsapp: false, label: CONTACT_LABEL });
  }
  const accounting = (ACCOUNTING_CNAES as readonly string[]).includes(c.cnaeMain);
  return {
    tradeName: names.tradeName,
    companyName: names.companyName,
    displayName: names.displayName,
    nameCore: names.nameCore,
    cnpj: c.cnpj,
    cnpjRoot: c.cnpjRoot,
    website: null,
    municipalityCode: c.municipalityCode,
    cityName: registryCity(c),
    stateUf: c.uf,
    postalCode: c.postalCode,
    addressLine: c.addressLine,
    addressNumber: c.addressNumber,
    addressComplement: c.addressComplement,
    neighborhood: c.neighborhood,
    person: null,
    contacts,
    segmentId: accounting ? segmentId : null,
    category: null,
    description: null,
    tagIds: [],
    customFields: {},
  };
}

/** Segmento "Contabilidade" do seed (os escritórios da base aberta entram nele). */
export async function accountingSegmentId(tx: DbTransaction): Promise<string | null> {
  const segment = await tx.segment.findUnique({
    where: { key: 'contabilidade' },
    select: { id: true, active: true },
  });
  return segment?.active ? segment.id : null;
}

/** Origem "Dados abertos CNPJ" ativa, com a base legal padrão. */
export async function requireRegistrySource(tx: DbTransaction) {
  const source = await tx.leadSource.findUnique({
    where: { key: REGISTRY_SOURCE_KEY },
    select: { id: true, active: true, defaultLegalBasis: true },
  });
  if (!source?.active) {
    throw new BusinessRuleError('A origem "Dados abertos CNPJ" está desativada.');
  }
  return source;
}

/** Texto da origem: a base e o mês de onde vieram os dados. */
export function registryOriginDetail(datasetReference: string): string {
  return `Base aberta do CNPJ (Receita Federal), mês ${datasetReference}`;
}
