/**
 * Chave de busca: minúscula, sem acentos, só letras/dígitos separados por um espaço.
 * Usada para colunas `*_search` (o `unaccent` do Postgres não pode ser usado em
 * índices, então a normalização é feita na aplicação — docs/DATABASE.md §1).
 *
 * Ex.: "São João del-Rei" → "sao joao del rei"; "SOBRAL/CE" → "sobral ce".
 */
export function toSearchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
