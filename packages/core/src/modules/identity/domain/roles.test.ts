import { describe, expect, it } from 'vitest';
import { twoFactorGate } from './roles';

describe('twoFactorGate', () => {
  it('bloqueia ADMIN e GESTOR sem a verificação quando ela é obrigatória', () => {
    expect(twoFactorGate('ADMIN', false, 'required')).toBe('blocked');
    expect(twoFactorGate('MANAGER', false, 'required')).toBe('blocked');
  });

  it('só lembra no modo de lembrete (desenvolvimento e testes)', () => {
    expect(twoFactorGate('ADMIN', false, 'reminder')).toBe('pending');
    expect(twoFactorGate('MANAGER', false, 'reminder')).toBe('pending');
  });

  it('libera quem já ativou e os perfis em que ela não é exigida', () => {
    expect(twoFactorGate('ADMIN', true, 'required')).toBe('ok');
    expect(twoFactorGate('MANAGER', true, 'reminder')).toBe('ok');
    for (const role of ['SDR', 'SALES'] as const) {
      expect(twoFactorGate(role, false, 'required')).toBe('ok');
      expect(twoFactorGate(role, false, 'reminder')).toBe('ok');
    }
  });
});
