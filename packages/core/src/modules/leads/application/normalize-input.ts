import type { ContactPointType, DbTransaction, LeadType, PhoneKind } from '@docline/db';
import { ValidationError, type ValidationIssue } from '../../../shared/errors';
import { maskEmail } from '../../../shared/mask';
import {
  maskPhone,
  normalizeCnpj,
  normalizeEmail,
  normalizeInstagram,
  normalizePhone,
  normalizePostalCode,
  normalizeUrl,
  type Normalized,
} from '../../normalization';
import { buildLeadNames } from '../domain/lead';

export interface NormalizedContact {
  type: ContactPointType;
  valueRaw: string;
  valueNormalized: string;
  phoneKind: PhoneKind | null;
  flags: string[];
}

export function normalizeContactValue(
  type: ContactPointType,
  raw: string,
  defaultDdd?: string | null,
): Normalized<NormalizedContact> {
  const valueRaw = raw.trim();
  if (type === 'PHONE') {
    const phone = normalizePhone(valueRaw, { defaultDdd });
    if (!phone.ok) return phone;
    return {
      ok: true,
      value: {
        type,
        valueRaw,
        valueNormalized: phone.value.e164,
        phoneKind: phone.value.kind,
        flags: phone.value.flags,
      },
    };
  }
  if (type === 'EMAIL') {
    const email = normalizeEmail(valueRaw);
    if (!email.ok) return email;
    return {
      ok: true,
      value: { type, valueRaw, valueNormalized: email.value.email, phoneKind: null, flags: [] },
    };
  }
  const instagram = normalizeInstagram(valueRaw);
  if (!instagram.ok) return instagram;
  return {
    ok: true,
    value: { type, valueRaw, valueNormalized: instagram.value.handle, phoneKind: null, flags: [] },
  };
}

/** Valor mascarado para auditoria, eventos e avisos de duplicidade. */
export function maskContactValue(type: ContactPointType, normalized: string): string {
  if (type === 'PHONE') return maskPhone(normalized);
  if (type === 'EMAIL') return maskEmail(normalized);
  return `@${normalized.slice(0, 2)}***`;
}

/** Campos do lead vindos do cadastro ou da edição (`undefined` = não alterar). */
export interface LeadFieldsInput {
  companyName?: string | null;
  tradeName?: string | null;
  leadType?: LeadType;
  segmentId?: string | null;
  category?: string | null;
  cnpj?: string | null;
  addressLine?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  postalCode?: string | null;
  municipalityCode?: number | null;
  cityRaw?: string | null;
  stateUf?: string | null;
  website?: string | null;
  description?: string | null;
}

/** Valores já normalizados, prontos para gravar (ausente = não alterar). */
export interface LeadFieldValues {
  companyName?: string | null;
  tradeName?: string | null;
  displayName?: string;
  nameSearch?: string;
  nameCore?: string;
  leadType?: LeadType;
  segmentId?: string | null;
  category?: string | null;
  cnpj?: string | null;
  cnpjRoot?: string | null;
  addressLine?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  cityRaw?: string | null;
  municipalityCode?: number | null;
  stateUf?: string | null;
  postalCode?: string | null;
  websiteUrl?: string | null;
  websiteDomain?: string | null;
  description?: string | null;
}

export interface ResolvedLeadFields {
  data: LeadFieldValues;
  /** DDD da cidade do lead, usado para completar telefones sem DDD. */
  defaultDdd: string | null;
}

const has = <K extends keyof LeadFieldsInput>(input: LeadFieldsInput, key: K) =>
  input[key] !== undefined;

/**
 * Normaliza e valida os campos do lead. Na edição, recebe os valores atuais e só
 * devolve o que mudou de fato pedido; erros vêm todos juntos, por campo.
 */
export async function resolveLeadFields(
  tx: DbTransaction,
  input: LeadFieldsInput,
  current?: {
    companyName: string | null;
    tradeName: string | null;
    municipalityCode: number | null;
  },
): Promise<ResolvedLeadFields> {
  const issues: ValidationIssue[] = [];
  const data: ResolvedLeadFields['data'] = {};

  if (!current || has(input, 'companyName') || has(input, 'tradeName')) {
    const names = buildLeadNames({
      companyName: has(input, 'companyName') ? input.companyName : current?.companyName,
      tradeName: has(input, 'tradeName') ? input.tradeName : current?.tradeName,
    });
    if (!names) {
      issues.push({ path: 'tradeName', message: 'Informe o nome fantasia ou a razão social.' });
    } else {
      Object.assign(data, names);
    }
  }

  for (const key of [
    'category',
    'addressLine',
    'addressNumber',
    'addressComplement',
    'neighborhood',
    'description',
  ] as const) {
    if (has(input, key)) data[key] = input[key] ?? null;
  }
  if (has(input, 'leadType') && input.leadType) data.leadType = input.leadType;

  if (has(input, 'segmentId')) {
    if (input.segmentId) {
      const segment = await tx.segment.findUnique({ where: { id: input.segmentId } });
      if (!segment) issues.push({ path: 'segmentId', message: 'Segmento não encontrado.' });
    }
    data.segmentId = input.segmentId ?? null;
  }

  if (has(input, 'cnpj')) {
    if (input.cnpj) {
      const cnpj = normalizeCnpj(input.cnpj);
      if (cnpj.ok) {
        data.cnpj = cnpj.value.cnpj;
        data.cnpjRoot = cnpj.value.root;
      } else {
        issues.push({ path: 'cnpj', message: cnpj.message });
      }
    } else {
      data.cnpj = null;
      data.cnpjRoot = null;
    }
  }

  if (has(input, 'postalCode')) {
    if (input.postalCode) {
      const cep = normalizePostalCode(input.postalCode);
      if (cep.ok) data.postalCode = cep.value;
      else issues.push({ path: 'postalCode', message: cep.message });
    } else {
      data.postalCode = null;
    }
  }

  if (has(input, 'website')) {
    if (input.website) {
      const url = normalizeUrl(input.website);
      if (url.ok) {
        data.websiteUrl = url.value.url;
        data.websiteDomain = url.value.domain;
      } else {
        issues.push({ path: 'website', message: url.message });
      }
    } else {
      data.websiteUrl = null;
      data.websiteDomain = null;
    }
  }

  let defaultDdd: string | null = null;
  const municipalityCode = has(input, 'municipalityCode')
    ? input.municipalityCode
    : current?.municipalityCode;
  if (has(input, 'municipalityCode') && input.municipalityCode) {
    const municipality = await tx.municipality.findUnique({
      where: { ibgeCode: input.municipalityCode },
      select: { ibgeCode: true, name: true, uf: true },
    });
    if (municipality) {
      data.municipalityCode = municipality.ibgeCode;
      data.stateUf = municipality.uf;
      data.cityRaw = municipality.name;
    } else {
      issues.push({ path: 'municipalityCode', message: 'Município não encontrado.' });
    }
  } else {
    if (has(input, 'municipalityCode')) data.municipalityCode = null;
    if (has(input, 'cityRaw')) data.cityRaw = input.cityRaw ?? null;
    if (has(input, 'stateUf')) {
      if (input.stateUf) {
        const state = await tx.state.findUnique({ where: { uf: input.stateUf } });
        if (state) data.stateUf = state.uf;
        else issues.push({ path: 'stateUf', message: 'UF não encontrada.' });
      } else {
        data.stateUf = null;
      }
    }
  }
  if (municipalityCode) {
    const municipality = await tx.municipality.findUnique({
      where: { ibgeCode: municipalityCode },
      select: { ddd: true },
    });
    defaultDdd = municipality?.ddd ? String(municipality.ddd) : null;
  }

  if (issues.length > 0) throw new ValidationError(issues);
  return { data, defaultDdd };
}
