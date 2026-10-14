import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDeps } from '../../testing/test-deps';
import {
  clearLoginThrottle,
  deviceIdFromToken,
  issueDeviceToken,
  loginRetryAfter,
  recordLoginFailure,
  type LoginAttempt,
} from '.';

const { db, deps, sent, createActor } = createTestDeps();
const SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres'; // gitleaks:allow (fictício)
const EMAIL = 'vitima@docline.example';
const meta = { ip: '203.0.113.10', requestId: 'req-test' };

async function fail(attempt: LoginAttempt, times: number) {
  for (let i = 0; i < times; i++) await recordLoginFailure(deps, attempt, meta);
}

describe('limite de login por conta', () => {
  beforeEach(async () => {
    await resetTestData(db);
    sent.length = 0;
  });

  afterAll(() => closeTestDb());

  it('sem atraso até 4 falhas; depois 30 s, 60 s… para a mesma conta e IP', async () => {
    const attacker = { email: EMAIL, ip: '198.51.100.7' };
    await fail(attacker, 4);
    expect(await loginRetryAfter(deps, attacker)).toBe(0);
    await fail(attacker, 1);
    expect(await loginRetryAfter(deps, attacker)).toBeGreaterThan(25);
    expect(await loginRetryAfter(deps, attacker)).toBeLessThanOrEqual(30);
    await fail(attacker, 1);
    expect(await loginRetryAfter(deps, attacker)).toBeGreaterThan(55);
    // E-mail em outra caixa é a mesma conta.
    expect(
      await loginRetryAfter(deps, { ...attacker, email: 'VITIMA@docline.example ' }),
    ).toBeGreaterThan(55);
  });

  it('quem erra a senha de um colega não tranca o colega (outro IP ou dispositivo conhecido)', async () => {
    const office = '198.51.100.7';
    await fail({ email: EMAIL, ip: office }, 10);
    expect(await loginRetryAfter(deps, { email: EMAIL, ip: office })).toBeGreaterThan(60);

    // De casa (outro IP), a dona da conta entra normalmente.
    expect(await loginRetryAfter(deps, { email: EMAIL, ip: '192.0.2.44' })).toBe(0);

    // No mesmo escritório, o navegador em que ela já entrou tem contador próprio.
    const token = issueDeviceToken(deps, SECRET, EMAIL);
    const deviceId = deviceIdFromToken(deps, SECRET, EMAIL, token);
    expect(deviceId).not.toBeNull();
    expect(await loginRetryAfter(deps, { email: EMAIL, ip: office, deviceId })).toBe(0);
  });

  it('o cookie de dispositivo só vale para a conta em que foi emitido e não pode ser alterado', () => {
    const token = issueDeviceToken(deps, SECRET, EMAIL);
    expect(deviceIdFromToken(deps, SECRET, 'outra@docline.example', token)).toBeNull();
    expect(
      deviceIdFromToken(deps, 'outro-segredo-com-pelo-menos-32-caracteres', EMAIL, token),
    ).toBeNull();
    expect(deviceIdFromToken(deps, SECRET, EMAIL, `${token}x`)).toBeNull();
    expect(deviceIdFromToken(deps, SECRET, EMAIL, 'lixo')).toBeNull();
    expect(deviceIdFromToken(deps, SECRET, EMAIL, null)).toBeNull();
  });

  it('login certo zera o contador da tentativa', async () => {
    const attempt = { email: EMAIL, ip: '198.51.100.7' };
    await fail(attempt, 3);
    await clearLoginThrottle(deps, attempt);
    await fail(attempt, 4);
    expect(await loginRetryAfter(deps, attempt)).toBe(0);
  });

  it('a janela de 15 min recomeça a contagem', async () => {
    const attempt = { email: EMAIL, ip: '198.51.100.7' };
    await fail(attempt, 4);
    await db.loginThrottle.updateMany({
      data: { windowStartedAt: new Date(Date.now() - 16 * 60_000) },
    });
    await fail(attempt, 1);
    const row = await db.loginThrottle.findFirstOrThrow({
      where: { key: { startsWith: 'pair:' } },
    });
    expect(row.failures).toBe(1);
    expect(await loginRetryAfter(deps, attempt)).toBe(0);
  });

  it('pico na conta (20 falhas, vários IPs) alerta os administradores uma vez, sem e-mail em claro', async () => {
    const { user: admin } = await createActor('ADMIN');
    const victim = await createActor('SDR');
    await db.user.update({ where: { id: victim.user.id }, data: { email: EMAIL } });
    for (let i = 0; i < 4; i++) await fail({ email: EMAIL, ip: `198.51.100.${i + 1}` }, 5);
    await fail({ email: EMAIL, ip: '198.51.100.99' }, 1);

    const alerts = await db.auditLog.findMany({ where: { action: 'auth.login_alert' } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.entityId).toBe(victim.user.id);
    expect(alerts[0]!.metadata).toMatchObject({ failures: 20, sources: 4 });
    expect(JSON.stringify(alerts[0]!.metadata)).not.toContain(EMAIL);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(admin.email);
    expect(sent[0]!.text).toContain('20 tentativas');
    expect(sent[0]!.text).not.toContain(EMAIL);
  });

  it('linhas paradas há mais de 1 dia são apagadas', async () => {
    await fail({ email: 'antiga@docline.example', ip: '198.51.100.7' }, 1);
    await db.loginThrottle.updateMany({
      data: { updatedAt: new Date(Date.now() - 2 * 86_400_000) },
    });
    await fail({ email: EMAIL, ip: '198.51.100.7' }, 1);
    expect(await db.loginThrottle.count()).toBe(2);
  });
});
