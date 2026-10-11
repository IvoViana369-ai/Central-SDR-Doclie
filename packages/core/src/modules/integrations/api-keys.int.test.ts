import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, RateLimitError, UnauthenticatedError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey } from './index';

const { db, deps, createActor } = createTestDeps();
const clock = deps.clock as typeof deps.clock & { advance(ms: number): void; set(d: Date): void };
const START = new Date('2026-10-14T12:00:00Z');

describe('chaves de API (F12-01)', () => {
  beforeEach(async () => {
    await resetTestData(db);
    clock.set(START);
  });
  afterAll(() => closeTestDb());

  it('cria com a chave inteira uma única vez; o banco guarda só prefixo e hash', async () => {
    const { user, actor } = await createActor('ADMIN');
    const created = await createApiKey(deps, actor, {
      name: 'CRM Docline',
      scopes: ['leads:read', 'references:write'],
      system: 'docline_crm',
    });
    expect(created.key).toMatch(/^dsdr_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(created.apiKey).toMatchObject({
      name: 'CRM Docline',
      prefix: created.key.slice(0, 13),
      scopes: ['leads:read', 'references:write'],
      system: 'DOCLINE_CRM',
      systemLabel: 'CRM Docline',
      status: 'ACTIVE',
      rateLimitPerMinute: 120,
    });
    expect(created.apiKey).not.toHaveProperty('keyHash');

    const row = await db.apiKey.findUniqueOrThrow({ where: { id: created.apiKey.id } });
    expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(created.key.slice(14));

    const listed = await listApiKeys(deps, actor, {});
    expect(listed.data).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.key.slice(14));
    expect(listed.data[0]!.createdByName).toBe(user.name);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'api_key.create' } });
    expect(JSON.stringify(audit)).not.toContain(created.key.slice(14));
    expect(audit.metadata).toMatchObject({ prefix: created.apiKey.prefix, system: 'DOCLINE_CRM' });
  });

  it('só o ADMIN gerencia chaves; validade precisa ser futura; escopo desconhecido recusado', async () => {
    const { actor: manager } = await createActor('MANAGER');
    await expect(
      createApiKey(deps, manager, { name: 'Gestor', scopes: ['leads:read'] }),
    ).rejects.toThrow(ForbiddenError);
    const { actor: admin } = await createActor('ADMIN');
    await expect(
      createApiKey(deps, admin, {
        name: 'Vencida',
        scopes: ['leads:read'],
        expiresAt: new Date('2026-10-13T00:00:00Z'),
      }),
    ).rejects.toMatchObject({
      issues: [{ path: 'expiresAt', message: 'A validade precisa ser futura.' }],
    });
    await expect(
      createApiKey(deps, admin, { name: 'Escopo', scopes: ['users:manage' as 'leads:read'] }),
    ).rejects.toThrow(/Dados inválidos/);
    await expect(createApiKey(deps, admin, { name: 'Vazia', scopes: [] })).rejects.toThrow(
      /Dados inválidos/,
    );
  });

  it('autentica pelo Bearer: ator com os escopos, último uso e IP gravados', async () => {
    const { actor } = await createActor('ADMIN');
    const { key, apiKey } = await createApiKey(deps, actor, {
      name: 'n8n',
      scopes: ['suppression:check'],
    });
    const keyActor = await authenticateApiKey(deps, key, { ip: '203.0.113.7' });
    expect(keyActor).toEqual({
      kind: 'apiKey',
      id: apiKey.id,
      name: 'n8n',
      scopes: ['suppression:check'],
      system: null,
    });
    const row = await db.apiKey.findUniqueOrThrow({ where: { id: apiKey.id } });
    expect(row.lastUsedAt).toEqual(START);
    expect(row.lastUsedIp).toBe('203.0.113.7');

    // Uma chave nunca administra chaves, mesmo com todos os escopos.
    const { key: full } = await createApiKey(deps, actor, {
      name: 'Tudo',
      scopes: [
        'leads:read',
        'references:read',
        'references:write',
        'suppression:check',
        'suppression:write',
        'bi:read',
      ],
    });
    const fullActor = await authenticateApiKey(deps, full);
    await expect(
      createApiKey(deps, fullActor, { name: 'Outra', scopes: ['leads:read'] }),
    ).rejects.toThrow(ForbiddenError);
    await expect(listApiKeys(deps, fullActor, {})).rejects.toThrow(ForbiddenError);
    const denied = await db.auditLog.findFirstOrThrow({ where: { action: 'access.denied' } });
    expect(denied.actorType).toBe('INTEGRATION');
    expect(denied.actorId).toBe(fullActor.id);
  });

  it('recusa formato errado, chave desconhecida, revogada e vencida', async () => {
    const { actor } = await createActor('ADMIN');
    await expect(authenticateApiKey(deps, 'qualquer-coisa')).rejects.toThrow(UnauthenticatedError);
    await expect(authenticateApiKey(deps, `dsdr_AAAAAAAA_${'x'.repeat(43)}`)).rejects.toThrow(
      UnauthenticatedError,
    );

    const revoked = await createApiKey(deps, actor, { name: 'Antiga', scopes: ['leads:read'] });
    const result = await revokeApiKey(deps, actor, {
      apiKeyId: revoked.apiKey.id,
      reason: 'Troca de integração',
    });
    expect(result.status).toBe('REVOKED');
    expect(result.revokeReason).toBe('Troca de integração');
    await expect(
      revokeApiKey(deps, actor, { apiKeyId: revoked.apiKey.id, reason: 'De novo' }),
    ).rejects.toThrow(/já foi revogada/);
    await expect(authenticateApiKey(deps, revoked.key)).rejects.toThrow(UnauthenticatedError);
    await expect(authenticateApiKey(deps, revoked.key)).rejects.toThrow(UnauthenticatedError);
    // Uso de chave revogada fica na auditoria (uma linha a cada 10 minutos).
    const rejected = await db.auditLog.findMany({ where: { action: 'api_key.rejected' } });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.metadata).toMatchObject({ reason: 'REVOKED', name: 'Antiga' });

    const expiring = await createApiKey(deps, actor, {
      name: 'Temporária',
      scopes: ['leads:read'],
      expiresAt: new Date('2026-10-15T12:00:00Z'),
    });
    await authenticateApiKey(deps, expiring.key);
    clock.set(new Date('2026-10-15T12:00:00Z'));
    await expect(authenticateApiKey(deps, expiring.key)).rejects.toThrow(UnauthenticatedError);
    const active = await listApiKeys(deps, actor, { status: 'ACTIVE' });
    expect(active.data).toHaveLength(0);
    const all = await listApiKeys(deps, actor, {});
    expect(all.data.map((k) => k.status).sort()).toEqual(['EXPIRED', 'REVOKED']);
  });

  it('limite por minuto da chave, com Retry-After; a janela volta depois de 1 minuto', async () => {
    const { actor } = await createActor('ADMIN');
    const { key } = await createApiKey(deps, actor, {
      name: 'BI',
      scopes: ['bi:read'],
      rateLimitPerMinute: 2,
    });
    await authenticateApiKey(deps, key);
    clock.advance(20_000);
    await authenticateApiKey(deps, key);
    const error = await authenticateApiKey(deps, key).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBe(40);
    clock.advance(40_000);
    await expect(authenticateApiKey(deps, key)).resolves.toMatchObject({ name: 'BI' });
  });
});
