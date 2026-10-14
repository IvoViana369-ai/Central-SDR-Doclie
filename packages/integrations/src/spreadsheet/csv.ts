import {
  SpreadsheetError,
  type ParsedSpreadsheet,
  type SpreadsheetLimits,
  type SpreadsheetRow,
} from '@docline/core';
import Papa from 'papaparse';

/**
 * Codificação do CSV: UTF-8 (com ou sem BOM), UTF-16 com BOM (exportação
 * "Texto Unicode" do Excel) ou, se não for UTF-8 válido, Windows-1252 (o
 * padrão do Excel em português).
 */
export function decodeText(content: Uint8Array): { text: string; encoding: string } {
  if (content[0] === 0xff && content[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(content.subarray(2)), encoding: 'utf-16le' };
  }
  const withoutBom =
    content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
      ? content.subarray(3)
      : content;
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(withoutBom),
      encoding: 'utf-8',
    };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(withoutBom), encoding: 'windows-1252' };
  }
}

export function readCsv(content: Uint8Array, limits: SpreadsheetLimits): ParsedSpreadsheet {
  const started = Date.now();
  const { text, encoding } = decodeText(content);
  if (text.includes('\u0000')) {
    throw new SpreadsheetError('UNSUPPORTED_TYPE', 'O arquivo não parece ser um CSV de texto.');
  }
  // A detecção do separador do Papa conta linhas vazias quando elas não são
  // puladas; por isso ela roda numa prévia à parte, sem linhas vazias.
  const guess = Papa.parse<string[]>(text, {
    delimiter: '',
    delimitersToGuess: [';', ',', '\t', '|'],
    skipEmptyLines: 'greedy',
    preview: 50,
  });
  const delimiter = guess.meta.delimiter || ',';
  const rows: SpreadsheetRow[] = [];
  let record = 0;
  Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
    step(step, parser) {
      record += 1;
      const cells = step.data.map((cell) => cell.trim());
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
      if (cells.length === 0) return;
      rows.push({ number: record, cells });
      if (rows.length > limits.maxRows) parser.abort();
      if (record % 1000 === 0 && Date.now() - started > limits.timeoutMs) parser.abort();
    },
  });
  if (rows.length > limits.maxRows) {
    throw new SpreadsheetError(
      'TOO_MANY_ROWS',
      `A planilha passa do limite de ${limits.maxRows.toLocaleString('pt-BR')} linhas. Divida o arquivo.`,
    );
  }
  if (Date.now() - started > limits.timeoutMs) {
    throw new SpreadsheetError('TIMEOUT', 'A leitura do arquivo demorou demais.');
  }
  if (rows.length === 0) throw new SpreadsheetError('EMPTY', 'O arquivo está vazio.');
  return {
    fileType: 'CSV',
    encoding,
    delimiter,
    sheetNames: [],
    sheetName: null,
    rows,
  };
}
