import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it('aceita caminhos internos', () => {
    expect(safeNextPath('/equipe?status=ACTIVE')).toBe('/equipe?status=ACTIVE');
  });

  it.each([
    null,
    '',
    'https://malicioso.example',
    '//malicioso.example',
    '/\\malicioso.example',
    'javascript:alert(1)',
  ])('recusa %s', (value) => {
    expect(safeNextPath(value)).toBe('/dashboard');
  });
});
