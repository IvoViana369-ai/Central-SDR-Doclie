import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/errors';
import { assertPasswordPolicy, passwordProblems } from './password-policy';

describe('política de senha', () => {
  it('aceita senha longa e não óbvia', () => {
    expect(passwordProblems('cavalo-correto-bateria-grampo')).toEqual([]);
  });

  it('exige no mínimo 12 caracteres', () => {
    expect(passwordProblems('curta123')).toEqual(['A senha deve ter pelo menos 12 caracteres.']);
  });

  it('limita o tamanho máximo', () => {
    expect(passwordProblems('a'.repeat(129) + 'b')).toContain(
      'A senha deve ter no máximo 128 caracteres.',
    );
  });

  it('recusa senhas comuns e repetições', () => {
    expect(passwordProblems('Senha1234567')).toContain('Essa senha é muito comum. Escolha outra.');
    expect(passwordProblems('aaaaaaaaaaaaaa')).toContain(
      'Essa senha é muito comum. Escolha outra.',
    );
  });

  it('recusa senha que contém o e-mail', () => {
    expect(passwordProblems('maria.souza2026!', { email: 'maria.souza@example.com' })).toContain(
      'A senha não pode conter o seu e-mail.',
    );
  });

  it('lança ValidationError com os problemas', () => {
    expect(() => assertPasswordPolicy('curta')).toThrow(ValidationError);
  });
});
