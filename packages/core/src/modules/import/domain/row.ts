import {
  cleanText,
  formatName,
  type MunicipalityIndex,
  nameCore,
  normalizeCnpj,
  normalizeEmail,
  normalizeInstagram,
  normalizePhone,
  normalizePostalCode,
  normalizeUf,
  normalizeUrl,
  splitList,
  toSearchKey,
} from '../../normalization';
import type { ColumnMapping, ImportField } from './fields';

export interface ImportContact {
  type: 'PHONE' | 'EMAIL' | 'INSTAGRAM';
  /** Valor normalizado (E.164, e-mail minúsculo, usuário do Instagram). */
  value: string;
  isWhatsapp: boolean;
  label: string | null;
}

/** Linha normalizada, pronta para casar com a base e para virar cadastro. */
export interface NormalizedImportRow {
  tradeName: string | null;
  companyName: string | null;
  displayName: string;
  nameCore: string;
  cnpj: string | null;
  cnpjRoot: string | null;
  website: string | null;
  municipalityCode: number | null;
  /** Nome da cidade (do IBGE, quando casou; senão como veio). */
  cityName: string | null;
  stateUf: string | null;
  postalCode: string | null;
  addressLine: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  person: { fullName: string; roleTitle: string | null } | null;
  contacts: ImportContact[];
  segmentId: string | null;
  category: string | null;
  description: string | null;
  tagIds: string[];
  customFields: Record<string, string>;
}

export interface RowIssue {
  /** Cabeçalho da coluna, quando o problema é de uma célula. */
  column: string | null;
  message: string;
}

export interface RowNormalization {
  normalized: NormalizedImportRow | null;
  errors: RowIssue[];
  warnings: RowIssue[];
}

export interface RowContext {
  municipalities: MunicipalityIndex;
  /** Segmentos e tags ativos pela chave de busca do nome. */
  segments: Map<string, string>;
  tags: Map<string, string>;
}

/** Limites dos campos do cadastro (createLeadInput). */
const MAX_LENGTH: Partial<Record<ImportField, number>> = {
  tradeName: 200,
  companyName: 200,
  addressLine: 200,
  addressNumber: 20,
  addressComplement: 100,
  neighborhood: 100,
  personName: 120,
  personRole: 80,
  category: 120,
  description: 5_000,
};

export function normalizeImportRow(
  cells: string[],
  mapping: ColumnMapping[],
  context: RowContext,
): RowNormalization {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const values = new Map<ImportField, { header: string; value: string }[]>();
  const customFields: Record<string, string> = {};

  for (const column of mapping) {
    const value = cleanText(cells[column.index] ?? '');
    if (!value || column.target === 'ignore') continue;
    if (column.target === 'custom') {
      customFields[column.customKey ?? column.header] = value.slice(0, 500);
      continue;
    }
    const list = values.get(column.target) ?? [];
    list.push({ header: column.header, value });
    values.set(column.target, list);
  }

  /** Valor único do campo, cortado no limite do cadastro (com aviso). */
  const single = (field: ImportField): { header: string; value: string } | null => {
    const entry = values.get(field)?.[0];
    if (!entry) return null;
    const max = MAX_LENGTH[field];
    if (max && entry.value.length > max) {
      warnings.push({ column: entry.header, message: `Texto cortado em ${max} caracteres.` });
      return { ...entry, value: entry.value.slice(0, max) };
    }
    return entry;
  };

  // Nome (obrigatório).
  const tradeName = single('tradeName');
  const companyName = single('companyName');
  const trade = tradeName ? formatName(tradeName.value) : null;
  const company = companyName ? formatName(companyName.value) : null;
  const displayName = trade ?? company;
  if (!displayName) {
    errors.push({ column: null, message: 'Sem nome (fantasia ou razão social).' });
  }

  // Cidade e UF.
  let municipalityCode: number | null = null;
  let cityName: string | null = null;
  let stateUf: string | null = null;
  let defaultDdd: string | null = null;
  const city = single('city');
  const state = single('state');
  if (state) {
    const uf = normalizeUf(state.value);
    if (uf.ok) stateUf = uf.value;
    else warnings.push({ column: state.header, message: uf.message });
  }
  if (city) {
    const match = context.municipalities.match(city.value, stateUf);
    if (match.status === 'MATCHED') {
      municipalityCode = match.municipality.ibgeCode;
      cityName = match.municipality.name;
      stateUf = match.municipality.uf;
      defaultDdd = match.municipality.ddd ? String(match.municipality.ddd) : null;
    } else {
      cityName = city.value;
      warnings.push({
        column: city.header,
        message:
          match.status === 'AMBIGUOUS'
            ? `"${city.value}" existe em mais de uma UF (${match.candidates.map((c) => c.uf).join(', ')}); informe a UF.`
            : `Cidade "${city.value}" não encontrada no cadastro do IBGE.`,
      });
    }
  }

  // CNPJ.
  let cnpj: string | null = null;
  let cnpjRoot: string | null = null;
  const cnpjCell = single('cnpj');
  if (cnpjCell) {
    const parsed = normalizeCnpj(cnpjCell.value);
    if (parsed.ok) {
      cnpj = parsed.value.cnpj;
      cnpjRoot = parsed.value.root;
    } else warnings.push({ column: cnpjCell.header, message: `${parsed.message} Valor ignorado.` });
  }

  // Contatos: vários por célula e várias colunas do mesmo tipo.
  const contacts: ImportContact[] = [];
  const addContact = (contact: ImportContact) => {
    const existing = contacts.find((c) => c.type === contact.type && c.value === contact.value);
    if (existing) existing.isWhatsapp ||= contact.isWhatsapp;
    else contacts.push(contact);
  };
  for (const field of ['phone', 'whatsapp'] as const) {
    for (const { header, value } of values.get(field) ?? []) {
      for (const part of splitList(value, { slash: true })) {
        const phone = normalizePhone(part, { defaultDdd });
        if (!phone.ok) {
          warnings.push({
            column: header,
            message: `Telefone "${part}" ignorado: ${phone.message}`,
          });
          continue;
        }
        addContact({
          type: 'PHONE',
          value: phone.value.e164,
          isWhatsapp: field === 'whatsapp' && phone.value.kind !== 'SERVICE',
          label: phone.value.extension ? `Ramal ${phone.value.extension}` : null,
        });
      }
    }
  }
  for (const { header, value } of values.get('email') ?? []) {
    for (const part of splitList(value)) {
      const email = normalizeEmail(part);
      if (email.ok)
        addContact({ type: 'EMAIL', value: email.value.email, isWhatsapp: false, label: null });
      else
        warnings.push({ column: header, message: `E-mail "${part}" ignorado: ${email.message}` });
    }
  }
  for (const { header, value } of values.get('instagram') ?? []) {
    for (const part of splitList(value)) {
      const instagram = normalizeInstagram(part);
      if (instagram.ok) {
        addContact({
          type: 'INSTAGRAM',
          value: instagram.value.handle,
          isWhatsapp: false,
          label: null,
        });
      } else {
        warnings.push({
          column: header,
          message: `Instagram "${part}" ignorado: ${instagram.message}`,
        });
      }
    }
  }

  // Site e CEP.
  let website: string | null = null;
  const site = single('website');
  if (site) {
    const url = normalizeUrl(site.value);
    if (url.ok) website = url.value.url;
    else warnings.push({ column: site.header, message: `${url.message} Valor ignorado.` });
  }
  let postalCode: string | null = null;
  const cep = single('postalCode');
  if (cep) {
    const parsed = normalizePostalCode(cep.value);
    if (parsed.ok) postalCode = parsed.value;
    else warnings.push({ column: cep.header, message: `${parsed.message} Valor ignorado.` });
  }

  // Pessoa de contato.
  const personName = single('personName');
  const personRole = single('personRole');
  let person: NormalizedImportRow['person'] = null;
  if (personName && personName.value.length >= 2) {
    person = { fullName: formatName(personName.value), roleTitle: personRole?.value ?? null };
  }

  // Segmento e tags existentes.
  let segmentId: string | null = null;
  const segment = single('segment');
  if (segment) {
    segmentId = context.segments.get(toSearchKey(segment.value)) ?? null;
    if (!segmentId) {
      warnings.push({ column: segment.header, message: `Segmento "${segment.value}" não existe.` });
    }
  }
  const tagIds: string[] = [];
  for (const { header, value } of values.get('tags') ?? []) {
    for (const name of splitList(value)) {
      const id = context.tags.get(toSearchKey(name));
      if (id) {
        if (!tagIds.includes(id)) tagIds.push(id);
      } else
        warnings.push({
          column: header,
          message: `Tag "${name}" não existe (crie antes de importar).`,
        });
    }
  }

  const description = (values.get('description') ?? [])
    .map((d) => d.value)
    .join('\n')
    .slice(0, 5_000);

  if (!displayName) return { normalized: null, errors, warnings };
  return {
    normalized: {
      tradeName: trade,
      companyName: company,
      displayName,
      nameCore: nameCore(displayName),
      cnpj,
      cnpjRoot,
      website,
      municipalityCode,
      cityName,
      stateUf,
      postalCode,
      addressLine: single('addressLine')?.value ?? null,
      addressNumber: single('addressNumber')?.value ?? null,
      addressComplement: single('addressComplement')?.value ?? null,
      neighborhood: single('neighborhood')?.value ?? null,
      person,
      contacts,
      segmentId,
      category: single('category')?.value ?? null,
      description: description || null,
      tagIds,
      customFields,
    },
    errors,
    warnings,
  };
}
