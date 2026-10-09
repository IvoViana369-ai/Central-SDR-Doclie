import { describe, expect, it } from 'vitest';
import { csvCell, neutralizeFormula, toCsv } from './csv';

describe('CSV', () => {
  it.each(['=1+1', '+5588', '-2+3', '@SUM(A1)', '\tx', '\rx', '  =HYPERLINK("x")'])(
    'neutraliza fórmula: %j',
    (value) => {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    },
  );

  it('não altera texto comum, telefone formatado nem CNPJ', () => {
    for (const value of ['Contabilidade Fictícia', '(88) 98765-4321', '12.345.678/0001-95']) {
      expect(neutralizeFormula(value)).toBe(value);
    }
  });

  it('coloca entre aspas o que tem separador, aspas ou quebra de linha', () => {
    expect(csvCell('Silva; Souza')).toBe('"Silva; Souza"');
    expect(csvCell('Escritório "Modelo"')).toBe('"Escritório ""Modelo"""');
    expect(csvCell('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
    expect(csvCell('=1;2')).toBe(`"'=1;2"`);
    expect(csvCell(null)).toBe('');
    expect(csvCell(-3)).toBe('-3');
  });

  it('gera arquivo com BOM, separador ; e CRLF', () => {
    expect(toCsv(['Código', 'Nome'], [['L-000001', 'Ação & Cia']])).toBe(
      '\uFEFFCódigo;Nome\r\nL-000001;Ação & Cia\r\n',
    );
  });
});
