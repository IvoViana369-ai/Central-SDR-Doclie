/**
 * Mesclagem campo a campo (docs/MVP.md M06): para cada grupo de campos, o
 * usuário escolhe o valor do sobrevivente ou o do lead mesclado. Grupos
 * (endereço, cidade, CNPJ, site) andam juntos para não misturar metades.
 */
export const MERGE_FIELDS = {
  tradeName: { label: 'Nome fantasia', columns: ['tradeName'] },
  companyName: { label: 'Razão social', columns: ['companyName'] },
  cnpj: { label: 'CNPJ', columns: ['cnpj', 'cnpjRoot', 'cnpjHash'] },
  leadType: { label: 'Tipo', columns: ['leadType'] },
  segment: { label: 'Segmento', columns: ['segmentId'] },
  category: { label: 'Categoria', columns: ['category'] },
  cnaeMain: { label: 'CNAE principal', columns: ['cnaeMain'] },
  location: { label: 'Cidade e UF', columns: ['municipalityCode', 'cityRaw', 'stateUf'] },
  address: {
    label: 'Endereço',
    columns: ['addressLine', 'addressNumber', 'addressComplement', 'neighborhood', 'postalCode'],
  },
  website: { label: 'Site', columns: ['websiteUrl', 'websiteDomain'] },
  owner: { label: 'Responsável', columns: ['ownerId'] },
  description: { label: 'Observações', columns: ['description'] },
} as const;

export type MergeField = keyof typeof MERGE_FIELDS;
export const MERGE_FIELD_KEYS = Object.keys(MERGE_FIELDS) as MergeField[];
export type MergeChoice = 'survivor' | 'merged';
export type MergeChoices = Record<MergeField, MergeChoice>;

type Column = (typeof MERGE_FIELDS)[MergeField]['columns'][number];
export type MergeableLead = Record<Column, unknown>;

const isEmpty = (value: unknown) => value === null || value === undefined || value === '';

/** O grupo de campos está vazio no lead? */
export function fieldIsEmpty(lead: MergeableLead, field: MergeField): boolean {
  return MERGE_FIELDS[field].columns.every((column) => isEmpty(lead[column]));
}

/** Os dois leads têm valores diferentes no grupo? */
export function fieldDiffers(a: MergeableLead, b: MergeableLead, field: MergeField): boolean {
  return MERGE_FIELDS[field].columns.some(
    (column) => (isEmpty(a[column]) ? null : a[column]) !== (isEmpty(b[column]) ? null : b[column]),
  );
}

/**
 * Escolhas padrão: fica o valor do sobrevivente; campo vazio nele é completado
 * com o do mesclado (nada se perde sem o usuário escolher).
 */
export function defaultMergeChoices(survivor: MergeableLead, merged: MergeableLead): MergeChoices {
  const choices = {} as MergeChoices;
  for (const field of MERGE_FIELD_KEYS) {
    choices[field] =
      fieldIsEmpty(survivor, field) && !fieldIsEmpty(merged, field) ? 'merged' : 'survivor';
  }
  return choices;
}

/**
 * Colunas a gravar no sobrevivente: só as dos grupos escolhidos do mesclado.
 * Nome vazio não é aceito (o lead precisa de fantasia ou razão social).
 */
export function mergedColumns(
  survivor: MergeableLead,
  merged: MergeableLead,
  choices: MergeChoices,
): { patch: Partial<MergeableLead>; fields: MergeField[] } {
  const patch: Partial<MergeableLead> = {};
  const fields: MergeField[] = [];
  for (const field of MERGE_FIELD_KEYS) {
    if (choices[field] !== 'merged' || !fieldDiffers(survivor, merged, field)) continue;
    fields.push(field);
    for (const column of MERGE_FIELDS[field].columns) patch[column] = merged[column] ?? null;
  }
  return { patch, fields };
}

/** Campos extras da importação: os do sobrevivente valem; os do mesclado completam. */
export function mergeCustomFields(
  survivor: unknown,
  merged: unknown,
): Record<string, unknown> | null {
  const a = survivor && typeof survivor === 'object' ? (survivor as Record<string, unknown>) : {};
  const b = merged && typeof merged === 'object' ? (merged as Record<string, unknown>) : {};
  const result = { ...b, ...a };
  return Object.keys(result).length > 0 ? result : null;
}
