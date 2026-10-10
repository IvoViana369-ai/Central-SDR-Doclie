/**
 * Geração de CSV para exportações (docs/SECURITY.md §7). Formato pensado para
 * o Excel em português: separador `;`, quebra de linha CRLF e BOM UTF-8 (sem o
 * BOM, acentos aparecem quebrados).
 */

export type CsvValue = string | number | null | undefined;

/** Caracteres que fazem planilhas interpretarem a célula como fórmula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Proteção contra CSV/formula injection: célula que começa (ignorando espaços)
 * com `=`, `+`, `-`, `@`, tab ou CR ganha um `'` na frente e é lida como texto.
 */
export function neutralizeFormula(value: string): string {
  // Só espaços são ignorados: tab e CR também iniciam fórmula.
  return FORMULA_START.test(value.replace(/^ +/, '')) ? `'${value}` : value;
}

export function csvCell(value: CsvValue, delimiter = ';'): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value) : neutralizeFormula(value);
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvValue[][], delimiter = ';'): string {
  const line = (cells: CsvValue[]) => cells.map((c) => csvCell(c, delimiter)).join(delimiter);
  return `\uFEFF${[line(header), ...rows.map(line)].join('\r\n')}\r\n`;
}
