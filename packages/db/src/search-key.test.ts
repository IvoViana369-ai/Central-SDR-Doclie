import { describe, expect, it } from 'vitest';
import { toSearchKey } from './search-key';

describe('toSearchKey', () => {
  it.each([
    ['São João del-Rei', 'sao joao del rei'],
    ['SOBRAL/CE', 'sobral ce'],
    ['  Itapajé  ', 'itapaje'],
    ["Olho d'Água das Flores", 'olho d agua das flores'],
    ['Açailândia', 'acailandia'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(toSearchKey(input)).toBe(expected);
  });

  it('é idempotente', () => {
    const once = toSearchKey('Contabilidade São José — Ltda.');
    expect(toSearchKey(once)).toBe(once);
  });
});
