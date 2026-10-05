import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { diffFields } from './diff';
import { ForbiddenError, UnauthenticatedError } from './errors';
import { escapeHtml } from './html';
import { maskEmail } from './mask';
import { generateToken, hashToken } from './tokens';
import { auditData, checkAccess } from './use-case';

const user = (
  role: 'ADMIN' | 'SDR',
  status: 'ACTIVE' | 'INACTIVE' | 'INVITED' = 'ACTIVE',
): Actor => ({
  kind: 'user',
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  role,
  status,
  teamId: null,
});

describe('checkAccess', () => {
  it('libera rotas públicas para qualquer ator', () => {
    expect(() => checkAccess({ kind: 'anonymous' }, 'public')).not.toThrow();
  });

  it('exige sessão fora das rotas públicas', () => {
    expect(() => checkAccess({ kind: 'anonymous' }, 'authenticated')).toThrow(UnauthenticatedError);
  });

  it('bloqueia usuários inativos ou ainda convidados', () => {
    expect(() => checkAccess(user('ADMIN', 'INACTIVE'), 'authenticated')).toThrow(
      UnauthenticatedError,
    );
    expect(() => checkAccess(user('ADMIN', 'INVITED'), 'authenticated')).toThrow(
      UnauthenticatedError,
    );
  });

  it('aplica a matriz de permissões', () => {
    expect(() => checkAccess(user('ADMIN'), 'user.manage')).not.toThrow();
    expect(() => checkAccess(user('SDR'), 'user.manage')).toThrow(ForbiddenError);
  });

  it('confia em atores de sistema (worker/CLI)', () => {
    expect(() => checkAccess({ kind: 'system', name: 'cli' }, 'user.manage')).not.toThrow();
  });
});

describe('auditData', () => {
  it('atribui a ação ao usuário e guarda metadados da requisição', () => {
    const data = auditData(
      user('ADMIN'),
      { ip: '10.0.0.1', requestId: 'req-1' },
      {
        action: 'x',
        entityType: 'user',
        entityId: '1',
        changes: { at: [new Date('2026-01-01T00:00:00Z'), null] },
      },
    );
    expect(data).toMatchObject({ actorType: 'USER', ip: '10.0.0.1', requestId: 'req-1' });
    expect(data.changes).toEqual({ at: ['2026-01-01T00:00:00.000Z', null] });
  });

  it('registra o nome do processo quando o ator é o sistema', () => {
    const data = auditData({ kind: 'system', name: 'cli' }, {}, { action: 'x', entityType: 'y' });
    expect(data).toMatchObject({ actorType: 'SYSTEM', actorId: null, metadata: { system: 'cli' } });
  });
});

describe('utilitários', () => {
  it('diffFields lista só o que mudou', () => {
    const before = { role: 'SDR', status: 'ACTIVE', name: 'Ana' };
    expect(
      diffFields(before, { role: 'MANAGER', status: 'ACTIVE' }, ['role', 'status', 'name']),
    ).toEqual({
      role: ['SDR', 'MANAGER'],
    });
  });

  it('escapeHtml neutraliza marcação', () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;',
    );
  });

  it('maskEmail esconde a parte local', () => {
    expect(maskEmail('joao.silva@example.com')).toBe('j***@example.com');
    expect(maskEmail('invalido')).toBe('***');
  });

  it('tokens são únicos e o hash é determinístico', () => {
    const a = generateToken();
    expect(a).not.toBe(generateToken());
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
