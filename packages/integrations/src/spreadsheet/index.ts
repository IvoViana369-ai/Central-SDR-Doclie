import {
  SpreadsheetError,
  type ParsedSpreadsheet,
  type SpreadsheetLimits,
  type SpreadsheetReader,
} from '@docline/core';
import { readCsv } from './csv';
import { readXlsx } from './xlsx';

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** Excel 97–2003 (.xls) e outros documentos OLE. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

const startsWith = (content: Uint8Array, signature: number[]) =>
  signature.every((byte, index) => content[index] === byte);

/**
 * Leitor de planilhas (docs/SECURITY.md §8): só .csv e .xlsx, conferindo a
 * extensão **e** a assinatura do arquivo.
 */
export function readSpreadsheet(
  file: { fileName: string; content: Uint8Array; sheet?: string | null },
  limits: SpreadsheetLimits,
): ParsedSpreadsheet {
  const extension = /\.([a-z0-9]+)$/i.exec(file.fileName)?.[1]?.toLowerCase() ?? '';
  if (file.content.length === 0) throw new SpreadsheetError('EMPTY', 'O arquivo está vazio.');
  if (file.content.length > limits.maxBytes) {
    const mb = Math.round(limits.maxBytes / 1024 / 1024);
    throw new SpreadsheetError('TOO_LARGE', `O arquivo passa do limite de ${mb} MB.`);
  }
  if (extension === 'xlsm' || extension === 'xltm') {
    throw new SpreadsheetError(
      'MACROS',
      'Planilhas com macros não são aceitas. Salve como .xlsx comum.',
    );
  }
  if (extension === 'xls' || startsWith(file.content, OLE_SIGNATURE)) {
    throw new SpreadsheetError(
      'UNSUPPORTED_TYPE',
      'O formato .xls (Excel 97–2003) não é aceito. Salve como .xlsx ou .csv.',
    );
  }
  const isZip = startsWith(file.content, ZIP_SIGNATURE);
  if (extension === 'xlsx') {
    if (!isZip)
      throw new SpreadsheetError('UNSUPPORTED_TYPE', 'O arquivo não é uma planilha .xlsx.');
    return readXlsx(file.content, file.sheet, limits);
  }
  if (extension === 'csv' || extension === 'txt') {
    if (isZip) throw new SpreadsheetError('UNSUPPORTED_TYPE', 'O arquivo não é um CSV de texto.');
    return readCsv(file.content, limits);
  }
  throw new SpreadsheetError('UNSUPPORTED_TYPE', 'Envie um arquivo .csv ou .xlsx.');
}

export const spreadsheetReader: SpreadsheetReader = { read: readSpreadsheet };
