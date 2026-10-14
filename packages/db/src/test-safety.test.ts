import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl } from '../test/safety';

describe('assertTestDatabaseUrl', () => {
  it('aceita bancos cujo nome termina em _test', () => {
    const url = 'postgresql://u:p@localhost:5432/docline_sdr_test?schema=public';
    expect(assertTestDatabaseUrl(url)).toBe(url);
  });

  it('recusa qualquer outro banco (evita apagar dados reais)', () => {
    expect(() => assertTestDatabaseUrl('postgresql://u:p@localhost:5432/docline_sdr')).toThrow(
      /_test/,
    );
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/DATABASE_URL_TEST/);
  });
});
