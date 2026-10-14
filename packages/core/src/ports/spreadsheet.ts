/**
 * Leitura de planilhas enviadas na importação (docs/SECURITY.md §8). O
 * adaptador lê CSV/XLSX como texto, sem executar nada, e recusa arquivos
 * fora dos limites. O core só recebe as linhas.
 */

export interface SpreadsheetLimits {
  maxBytes: number;
  /** Linhas com conteúdo, contando o cabeçalho. */
  maxRows: number;
  /** Tempo máximo de leitura. */
  timeoutMs: number;
}

export interface SpreadsheetRow {
  /** Linha na planilha (1 = primeira linha do arquivo ou da aba). */
  number: number;
  cells: string[];
}

export interface ParsedSpreadsheet {
  fileType: 'CSV' | 'XLSX';
  /** CSV: "utf-8", "windows-1252" ou "utf-16le". */
  encoding: string | null;
  /** CSV: separador detectado. */
  delimiter: string | null;
  /** XLSX: abas visíveis, na ordem da planilha. */
  sheetNames: string[];
  sheetName: string | null;
  /** Só linhas com conteúdo; células como texto, sem espaços nas pontas. */
  rows: SpreadsheetRow[];
}

export type SpreadsheetErrorCode =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'TOO_MANY_ROWS'
  | 'UNSUPPORTED_TYPE'
  | 'MACROS'
  | 'ZIP_BOMB'
  | 'CORRUPTED'
  | 'SHEET_NOT_FOUND'
  | 'TIMEOUT';

/** Arquivo recusado; a mensagem é mostrada ao usuário. */
export class SpreadsheetError extends Error {
  constructor(
    readonly code: SpreadsheetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SpreadsheetError';
  }
}

export interface SpreadsheetReader {
  read(
    file: { fileName: string; content: Uint8Array; sheet?: string | null },
    limits: SpreadsheetLimits,
  ): ParsedSpreadsheet;
}
