import { SpreadsheetError } from '@docline/core';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readSpreadsheet } from './index';

/** Planilhas montadas no teste, com dados fictícios (sem arquivos binários no repositório). */
const LIMITS = { maxBytes: 10 * 1024 * 1024, maxRows: 50_000, timeoutMs: 10_000 };

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Cell =
  string | number | boolean | { formula: string; cached: string } | { error: string } | null;

function columnRef(index: number): string {
  let ref = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    ref = String.fromCharCode(65 + ((n - 1) % 26)) + ref;
  }
  return ref;
}

function makeXlsx(
  sheets: { name: string; rows: { r: number; cells: Cell[] }[]; hidden?: boolean }[],
  extra: Zippable = {},
): Uint8Array {
  const strings: string[] = [];
  const stringIndex = (text: string) => {
    const found = strings.indexOf(text);
    if (found >= 0) return found;
    strings.push(text);
    return strings.length - 1;
  };
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
  };
  sheets.forEach((sheet, index) => {
    const rows = sheet.rows
      .map(({ r, cells }) => {
        const xml = cells
          .map((cell, c) => {
            const ref = `${columnRef(c)}${r}`;
            if (cell === null) return '';
            if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
            if (typeof cell === 'boolean') return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
            if (typeof cell === 'object' && 'formula' in cell)
              return `<c r="${ref}" t="str"><f>${escape(cell.formula)}</f><v>${escape(cell.cached)}</v></c>`;
            if (typeof cell === 'object') return `<c r="${ref}" t="e"><v>${cell.error}</v></c>`;
            if (cell.startsWith('inline:'))
              return `<c r="${ref}" t="inlineStr"><is><t>${escape(cell.slice(7))}</t></is></c>`;
            return `<c r="${ref}" t="s"><v>${stringIndex(cell)}</v></c>`;
          })
          .join('');
        return `<row r="${r}">${xml}</row>`;
      })
      .join('');
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (s, i) =>
          `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.hidden ? ' state="hidden"' : ''}/>`,
      )
      .join('')}</sheets></workbook>`,
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}</Relationships>`,
  );
  // Texto rico (vários trechos) e fonética (que não faz parte do valor).
  files['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings
      .map((s) =>
        s.includes('|')
          ? `<si>${s
              .split('|')
              .map((part) => `<r><t xml:space="preserve">${escape(part)}</t></r>`)
              .join('')}<rPh><t>フリガナ</t></rPh></si>`
          : `<si><t>${escape(s)}</t></si>`,
      )
      .join('')}</sst>`,
  );
  return zipSync({ ...files, ...extra });
}

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SpreadsheetError);
    expect((error as SpreadsheetError).code).toBe(code);
    return;
  }
  throw new Error(`esperava SpreadsheetError ${code}`);
}

describe('CSV', () => {
  it('UTF-8 com BOM e ";": aspas, linhas vazias e números das linhas', () => {
    const text =
      '﻿Nome;Telefone;Cidade\n"Contábil; Exemplo";(88) 99999-0001;Sobral\n\n;;\nAlfa Ltda;88999990002;Fortaleza\n';
    const sheet = readSpreadsheet(
      { fileName: 'leads.csv', content: new TextEncoder().encode(text) },
      LIMITS,
    );
    expect(sheet).toMatchObject({ fileType: 'CSV', encoding: 'utf-8', delimiter: ';' });
    expect(sheet.rows).toEqual([
      { number: 1, cells: ['Nome', 'Telefone', 'Cidade'] },
      { number: 2, cells: ['Contábil; Exemplo', '(88) 99999-0001', 'Sobral'] },
      { number: 5, cells: ['Alfa Ltda', '88999990002', 'Fortaleza'] },
    ]);
  });

  it('Windows-1252 (padrão do Excel em português) com ","', () => {
    const content = Buffer.from('Município,Escritório\r\nSão João,Contábil Ação\r\n', 'latin1');
    const sheet = readSpreadsheet({ fileName: 'LEADS.CSV', content }, LIMITS);
    expect(sheet).toMatchObject({ encoding: 'windows-1252', delimiter: ',' });
    expect(sheet.rows[1]!.cells).toEqual(['São João', 'Contábil Ação']);
  });

  it('UTF-16 com BOM e tabulação (exportação "Texto Unicode")', () => {
    const body = Buffer.from('Nome\tE-mail\nBeta\tbeta@ficticio.com.br\n', 'utf16le');
    const content = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
    const sheet = readSpreadsheet({ fileName: 'leads.txt', content }, LIMITS);
    expect(sheet).toMatchObject({ encoding: 'utf-16le', delimiter: '\t' });
    expect(sheet.rows[1]!.cells).toEqual(['Beta', 'beta@ficticio.com.br']);
  });

  it('fórmula vira texto, nunca é avaliada', () => {
    const sheet = readSpreadsheet(
      { fileName: 'x.csv', content: new TextEncoder().encode('Nome\n=HYPERLINK("http://x")\n') },
      LIMITS,
    );
    expect(sheet.rows[1]!.cells).toEqual(['=HYPERLINK("http://x")']);
  });

  it('limites de linhas e tamanho; arquivo vazio', () => {
    const many = 'Nome\n' + Array.from({ length: 11 }, (_, i) => `Lead ${i}`).join('\n');
    expectError(
      () =>
        readSpreadsheet(
          { fileName: 'x.csv', content: new TextEncoder().encode(many) },
          { ...LIMITS, maxRows: 10 },
        ),
      'TOO_MANY_ROWS',
    );
    expectError(
      () =>
        readSpreadsheet(
          { fileName: 'x.csv', content: new Uint8Array(2048).fill(65) },
          { ...LIMITS, maxBytes: 1024 },
        ),
      'TOO_LARGE',
    );
    expectError(
      () =>
        readSpreadsheet(
          { fileName: 'x.csv', content: new TextEncoder().encode('\n\n  \n') },
          LIMITS,
        ),
      'EMPTY',
    );
  });
});

describe('XLSX', () => {
  const workbook = () =>
    makeXlsx([
      { name: 'Oculta', hidden: true, rows: [{ r: 1, cells: ['segredo'] }] },
      {
        name: 'Leads 2026',
        rows: [
          { r: 1, cells: ['Lista fictícia de escritórios'] },
          { r: 3, cells: ['Nome', 'Telefone', 'CNPJ', 'Cliente?', 'Obs'] },
          {
            r: 4,
            cells: ['Contábil |Exemplo', 88999990001, 11222333000181, true, { error: '#N/A' }],
          },
          { r: 5, cells: ['inline:Escritório Beta', '1.1222333000181E13', null, false, '  '] },
          { r: 6, cells: [{ formula: 'A4&"X"', cached: 'Contábil ExemploX' }] },
        ],
      },
      {
        name: 'Outra',
        rows: [
          { r: 1, cells: ['Nome'] },
          { r: 2, cells: ['Gama'] },
        ],
      },
    ]);

  it('lê a primeira aba visível, com linhas vazias puladas e números das linhas', () => {
    const sheet = readSpreadsheet({ fileName: 'leads.xlsx', content: workbook() }, LIMITS);
    expect(sheet.sheetNames).toEqual(['Leads 2026', 'Outra']);
    expect(sheet.sheetName).toBe('Leads 2026');
    expect(sheet.rows).toEqual([
      { number: 1, cells: ['Lista fictícia de escritórios'] },
      { number: 3, cells: ['Nome', 'Telefone', 'CNPJ', 'Cliente?', 'Obs'] },
      { number: 4, cells: ['Contábil Exemplo', '88999990001', '11222333000181', 'true'] },
      { number: 5, cells: ['Escritório Beta', '1.1222333000181E13', '', 'false'] },
      { number: 6, cells: ['Contábil ExemploX'] },
    ]);
  });

  it('escolhe outra aba pelo nome; aba inexistente é recusada', () => {
    const sheet = readSpreadsheet(
      { fileName: 'leads.xlsx', content: workbook(), sheet: 'Outra' },
      LIMITS,
    );
    expect(sheet.rows.map((r) => r.cells[0])).toEqual(['Nome', 'Gama']);
    expectError(
      () =>
        readSpreadsheet({ fileName: 'leads.xlsx', content: workbook(), sheet: 'Oculta' }, LIMITS),
      'SHEET_NOT_FOUND',
    );
  });

  it('número grande gravado em notação científica volta ao inteiro', () => {
    const content = makeXlsx([{ name: 'A', rows: [{ r: 1, cells: [1.1222333000181e13] }] }]);
    expect(readSpreadsheet({ fileName: 'a.xlsx', content }, LIMITS).rows[0]!.cells).toEqual([
      '11222333000181',
    ]);
  });

  it('recusa macros (pela extensão e pelo conteúdo)', () => {
    expectError(
      () => readSpreadsheet({ fileName: 'a.xlsm', content: workbook() }, LIMITS),
      'MACROS',
    );
    const withMacro = makeXlsx([{ name: 'A', rows: [{ r: 1, cells: ['x'] }] }], {
      'xl/vbaProject.bin': new Uint8Array([1, 2, 3]),
    });
    expectError(
      () => readSpreadsheet({ fileName: 'a.xlsx', content: withMacro }, LIMITS),
      'MACROS',
    );
  });

  it('protege contra zip bomb: tamanho declarado e número de entradas', () => {
    const content = makeXlsx([{ name: 'A', rows: [{ r: 1, cells: ['x'] }] }]);
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    for (let i = 0; i < content.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0x7fffffff, true);
    }
    expectError(() => readSpreadsheet({ fileName: 'a.xlsx', content }, LIMITS), 'ZIP_BOMB');

    const entries: Zippable = {};
    for (let i = 0; i < 2_001; i++) entries[`lixo/${i}.txt`] = new Uint8Array([0]);
    const crowded = makeXlsx([{ name: 'A', rows: [{ r: 1, cells: ['x'] }] }], entries);
    expectError(
      () => readSpreadsheet({ fileName: 'a.xlsx', content: crowded }, LIMITS),
      'ZIP_BOMB',
    );
  });

  it('conteúdo que mente o tamanho é cortado no tamanho declarado (não cresce)', () => {
    const big = new Uint8Array(5 * 1024 * 1024).fill(32);
    const content = makeXlsx([{ name: 'A', rows: [{ r: 1, cells: ['x'] }] }], {
      'xl/worksheets/sheet1.xml': big,
    });
    const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
    for (let i = 0; i < content.length - 4; i++) {
      const signature = view.getUint32(i, true);
      if (signature === 0x04034b50) view.setUint32(i + 22, 64, true);
      if (signature === 0x02014b50) view.setUint32(i + 24, 64, true);
    }
    expectError(() => readSpreadsheet({ fileName: 'a.xlsx', content }, LIMITS), 'CORRUPTED');
  });

  it('assinatura precisa bater com a extensão; .xls e outros formatos são recusados', () => {
    const csv = new TextEncoder().encode('Nome\nAlfa\n');
    expectError(
      () => readSpreadsheet({ fileName: 'a.xlsx', content: csv }, LIMITS),
      'UNSUPPORTED_TYPE',
    );
    expectError(
      () => readSpreadsheet({ fileName: 'a.csv', content: workbook() }, LIMITS),
      'UNSUPPORTED_TYPE',
    );
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    expectError(
      () => readSpreadsheet({ fileName: 'a.xls', content: ole }, LIMITS),
      'UNSUPPORTED_TYPE',
    );
    expectError(
      () => readSpreadsheet({ fileName: 'a.pdf', content: csv }, LIMITS),
      'UNSUPPORTED_TYPE',
    );
    expectError(
      () =>
        readSpreadsheet(
          { fileName: 'a.xlsx', content: new Uint8Array([0x50, 0x4b, 3, 4, 9]) },
          LIMITS,
        ),
      'CORRUPTED',
    );
  });

  it('limite de linhas também no XLSX', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ r: i + 1, cells: [`Lead ${i}`] }));
    const content = makeXlsx([{ name: 'A', rows }]);
    expectError(
      () => readSpreadsheet({ fileName: 'a.xlsx', content }, { ...LIMITS, maxRows: 10 }),
      'TOO_MANY_ROWS',
    );
  });
});
