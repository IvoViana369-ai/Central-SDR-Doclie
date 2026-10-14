import {
  SpreadsheetError,
  type ParsedSpreadsheet,
  type SpreadsheetLimits,
  type SpreadsheetRow,
} from '@docline/core';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { SaxesParser, type SaxesTagPlain } from 'saxes';

/**
 * Leitor mínimo de XLSX (só valores das células, como texto), sem ExcelJS:
 * - o ZIP é inspecionado antes de descompactar: total declarado, número de
 *   entradas e macros (proteção contra zip bomb, docs/SECURITY.md §8);
 * - a descompactação usa buffers do tamanho declarado, então um arquivo que
 *   mente o tamanho não consegue crescer além do limite;
 * - XML lido em streaming (saxes), sem DTD nem entidades externas;
 * - nada é avaliado: fórmulas valem pelo último resultado gravado no arquivo.
 */

const MAX_ENTRIES = 2_000;
/** Teto absoluto para o conteúdo descompactado (além de 30× o tamanho do arquivo). */
const MAX_UNCOMPRESSED = 250 * 1024 * 1024;
const MACRO_ENTRY = /(^|\/)vbaProject\.bin$/i;

interface SheetRef {
  name: string;
  path: string;
}

function inspect(content: Uint8Array, limits: SpreadsheetLimits): void {
  const maxUncompressed = Math.min(
    MAX_UNCOMPRESSED,
    Math.max(limits.maxBytes, content.length) * 30,
  );
  let entries = 0;
  let total = 0;
  try {
    unzipSync(content, {
      filter(file: UnzipFileInfo) {
        entries += 1;
        total += file.originalSize;
        if (MACRO_ENTRY.test(file.name)) {
          throw new SpreadsheetError(
            'MACROS',
            'Planilhas com macros não são aceitas. Salve como .xlsx comum.',
          );
        }
        if (entries > MAX_ENTRIES || total > maxUncompressed) {
          throw new SpreadsheetError('ZIP_BOMB', 'O arquivo é grande demais quando descompactado.');
        }
        return false;
      },
    });
  } catch (error) {
    if (error instanceof SpreadsheetError) throw error;
    throw new SpreadsheetError(
      'CORRUPTED',
      'Não foi possível abrir a planilha (arquivo corrompido?).',
    );
  }
}

function extract(content: Uint8Array, names: string[]): Record<string, Uint8Array> {
  const wanted = new Set(names);
  try {
    return unzipSync(content, { filter: (file) => wanted.has(file.name) });
  } catch {
    throw new SpreadsheetError(
      'CORRUPTED',
      'Não foi possível abrir a planilha (arquivo corrompido?).',
    );
  }
}

/** Percorre um XML em streaming, em pedaços (sem montar uma string enorme). */
function parseXml(
  data: Uint8Array,
  handlers: {
    open?: (tag: SaxesTagPlain) => void;
    close?: (name: string) => void;
    text?: (text: string) => void;
  },
  deadline: number,
): void {
  const parser = new SaxesParser({ xmlns: false });
  parser.on('error', () => {
    throw new SpreadsheetError('CORRUPTED', 'A planilha tem um XML inválido.');
  });
  parser.on('doctype', () => {
    throw new SpreadsheetError('CORRUPTED', 'A planilha tem um XML não suportado.');
  });
  if (handlers.open) parser.on('opentag', handlers.open);
  if (handlers.close) parser.on('closetag', (tag) => handlers.close!(tag.name));
  if (handlers.text) parser.on('text', handlers.text);
  const decoder = new TextDecoder('utf-8');
  const CHUNK = 1024 * 1024;
  for (let offset = 0; offset < data.length; offset += CHUNK) {
    parser.write(decoder.decode(data.subarray(offset, offset + CHUNK), { stream: true }));
    if (Date.now() > deadline)
      throw new SpreadsheetError('TIMEOUT', 'A leitura da planilha demorou demais.');
  }
  parser.write(decoder.decode());
  parser.close();
}

const local = (name: string) => name.slice(name.indexOf(':') + 1);

function sheetsOf(files: Record<string, Uint8Array>, deadline: number): SheetRef[] {
  const workbook = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (!workbook || !rels) {
    throw new SpreadsheetError('UNSUPPORTED_TYPE', 'O arquivo não é uma planilha .xlsx.');
  }
  const targets = new Map<string, string>();
  parseXml(
    rels,
    {
      open(tag) {
        if (local(tag.name) === 'Relationship') {
          targets.set(String(tag.attributes.Id), String(tag.attributes.Target));
        }
      },
    },
    deadline,
  );
  const sheets: SheetRef[] = [];
  parseXml(
    workbook,
    {
      open(tag) {
        if (local(tag.name) !== 'sheet') return;
        const state = String(tag.attributes.state ?? 'visible');
        const rid = Object.entries(tag.attributes).find(([key]) => local(key) === 'id')?.[1];
        const target = rid ? targets.get(String(rid)) : undefined;
        if (!target || state !== 'visible') return;
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
        sheets.push({ name: String(tag.attributes.name), path });
      },
    },
    deadline,
  );
  return sheets;
}

function sharedStrings(data: Uint8Array | undefined, deadline: number): string[] {
  if (!data) return [];
  const strings: string[] = [];
  let current: string | null = null;
  let inText = false;
  let phonetic = 0;
  parseXml(
    data,
    {
      open(tag) {
        const name = local(tag.name);
        if (name === 'si') current = '';
        else if (name === 'rPh') phonetic += 1;
        else if (name === 't' && phonetic === 0) inText = true;
      },
      close(name) {
        const tag = local(name);
        if (tag === 'si') {
          strings.push(current ?? '');
          current = null;
        } else if (tag === 'rPh') phonetic -= 1;
        else if (tag === 't') inText = false;
      },
      text(text) {
        if (inText && current !== null) current += text;
      },
    },
    deadline,
  );
  return strings;
}

/** "AB12" → 27 (índice da coluna, base 0). */
function columnIndex(ref: string): number | null {
  const letters = /^[A-Z]+/i.exec(ref)?.[0];
  if (!letters) return null;
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/** Números grandes gravados em notação científica voltam ao inteiro (ex.: CNPJ). */
function numberText(value: string): string {
  if (!/e/i.test(value)) return value;
  const number = Number(value);
  return Number.isInteger(number) && Math.abs(number) < 1e21
    ? number.toLocaleString('en-US', { useGrouping: false })
    : value;
}

function readSheet(
  data: Uint8Array,
  strings: string[],
  limits: SpreadsheetLimits,
  deadline: number,
): SpreadsheetRow[] {
  const rows: SpreadsheetRow[] = [];
  let rowNumber = 0;
  let cells: string[] = [];
  let cellType = '';
  let cellIndex = 0;
  let value = '';
  let capture: 'v' | 't' | null = null;
  let inCell = false;

  parseXml(
    data,
    {
      open(tag) {
        const name = local(tag.name);
        if (name === 'row') {
          const r = Number(tag.attributes.r);
          rowNumber = Number.isInteger(r) && r > 0 ? r : rowNumber + 1;
          cells = [];
        } else if (name === 'c') {
          inCell = true;
          cellType = String(tag.attributes.t ?? 'n');
          const ref = tag.attributes.r ? columnIndex(String(tag.attributes.r)) : null;
          cellIndex = ref ?? cells.length;
          value = '';
        } else if (inCell && (name === 'v' || (name === 't' && cellType === 'inlineStr'))) {
          capture = name;
        }
      },
      close(name) {
        const tag = local(name);
        if (tag === 'v' || tag === 't') capture = null;
        else if (tag === 'c') {
          inCell = false;
          let text = value;
          if (cellType === 's') text = strings[Number(value)] ?? '';
          else if (cellType === 'b') text = value === '1' ? 'true' : 'false';
          else if (cellType === 'e') text = '';
          else if (cellType === 'n') text = numberText(value);
          text = text.trim();
          if (text !== '' && cellIndex < 1_000) {
            while (cells.length < cellIndex) cells.push('');
            cells[cellIndex] = text;
          }
        } else if (tag === 'row') {
          while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
          if (cells.length > 0) {
            rows.push({ number: rowNumber, cells });
            if (rows.length > limits.maxRows) {
              throw new SpreadsheetError(
                'TOO_MANY_ROWS',
                `A planilha passa do limite de ${limits.maxRows.toLocaleString('pt-BR')} linhas. Divida o arquivo.`,
              );
            }
          }
        }
      },
      text(text) {
        if (capture) value += text;
      },
    },
    deadline,
  );
  return rows;
}

export function readXlsx(
  content: Uint8Array,
  sheet: string | null | undefined,
  limits: SpreadsheetLimits,
): ParsedSpreadsheet {
  const deadline = Date.now() + limits.timeoutMs;
  inspect(content, limits);
  const meta = extract(content, ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels']);
  const sheets = sheetsOf(meta, deadline);
  if (sheets.length === 0) throw new SpreadsheetError('EMPTY', 'A planilha não tem abas visíveis.');
  const chosen = sheet ? sheets.find((s) => s.name === sheet) : sheets[0];
  if (!chosen) throw new SpreadsheetError('SHEET_NOT_FOUND', `A aba "${sheet}" não existe.`);

  const files = extract(content, ['xl/sharedStrings.xml', chosen.path]);
  const sheetData = files[chosen.path];
  if (!sheetData) throw new SpreadsheetError('CORRUPTED', 'A aba escolhida está corrompida.');
  const rows = readSheet(
    sheetData,
    sharedStrings(files['xl/sharedStrings.xml'], deadline),
    limits,
    deadline,
  );
  if (rows.length === 0) throw new SpreadsheetError('EMPTY', `A aba "${chosen.name}" está vazia.`);
  return {
    fileType: 'XLSX',
    encoding: null,
    delimiter: null,
    sheetNames: sheets.map((s) => s.name),
    sheetName: chosen.name,
    rows,
  };
}
