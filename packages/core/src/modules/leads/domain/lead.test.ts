import { describe, expect, it } from 'vitest';
import { buildLeadNames, firstNameOf, formatLeadCode, parseLeadCode } from './lead';

describe('código do lead', () => {
  it('formata e interpreta o código legível', () => {
    expect(formatLeadCode(123)).toBe('L-000123');
    expect(formatLeadCode(1234567)).toBe('L-1234567');
    for (const input of ['L-000123', 'l123', '123', ' L-123 ']) {
      expect(parseLeadCode(input), input).toBe(123);
    }
    expect(parseLeadCode('X-12')).toBeNull();
  });
});

describe('buildLeadNames', () => {
  it('usa o nome fantasia e, na falta, a razão social', () => {
    expect(
      buildLeadNames({ companyName: 'Silva Contabilidade Ltda', tradeName: '  Contábil   Silva ' }),
    ).toEqual({
      companyName: 'Silva Contabilidade Ltda',
      tradeName: 'Contábil Silva',
      displayName: 'Contábil Silva',
      nameSearch: 'contabil silva',
      nameCore: 'silva',
    });
    expect(buildLeadNames({ companyName: 'Escritório Ávila', tradeName: '' })?.displayName).toBe(
      'Escritório Ávila',
    );
  });

  it('exige ao menos um dos nomes', () => {
    expect(buildLeadNames({ companyName: ' ', tradeName: null })).toBeNull();
  });

  it('primeiro nome para saudações', () => {
    expect(firstNameOf('  Maria Clara Souza ')).toBe('Maria');
  });
});
