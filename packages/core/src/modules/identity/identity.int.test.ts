import { closeTestDb, getTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../shared/actor';
import { FakeAiProvider } from '../ai-sdr';
import { fixedClock } from '../../shared/clock';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../shared/errors';
import type { Logger } from '../../shared/logger';
import { createIdentifierHasher } from '../../shared/identifier-hash';
import { hashToken } from '../../shared/tokens';
import type { CoreDeps } from '../../shared/use-case';
import type { TransactionalEmail } from '../../ports/email';
import { listAuditLogs } from '../audit';
import {
  acceptInvitation,
  changeUserRole,
  getCurrentUser,
  INVITATION_TTL_MS,
  inviteUser,
  listUsers,
  recordSignIn,
  resendInvitation,
  resetUserTwoFactor,
  resolveActor,
  setUserStatus,
} from '.';

const db = getTestDb();
const clock = fixedClock(new Date('2026-10-13T12:00:00Z'));
const sent: TransactionalEmail[] = [];
let emailFails = false;
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const deps: CoreDeps = {
  db,
  clock,
  logger,
  appUrl: 'https://sdr.example.com',
  email: {
    name: 'memory',
    async send(email) {
      if (emailFails) throw new Error('SMTP fora do ar');
      sent.push(email);
    },
  },
  passwordHasher: { hash: async (password) => `hashed:${password}` },
  identifiers: createIdentifierHasher('pepper-de-teste-com-pelo-menos-32-caracteres'),
  jobs: { enqueue: async () => null },
  importLimits: { maxBytes: 10 * 1024 * 1024, maxRows: 50_000 },
  ai: new FakeAiProvider(),
  aiLimits: {
    effortGeneration: 'medium',
    effortClassification: 'low',
    maxGenerationsPerUserPerDay: 200,
    monthlyBudgetUsd: null,
  },
  whatsapp: null,
  instagram: null,
  companyRegistry: null,
};

const STRONG_PASSWORD = 'cavalo-correto-bateria-grampo';

async function createUser(
  role: 'ADMIN' | 'MANAGER' | 'SDR' | 'SALES',
  email: string,
  status = 'ACTIVE' as const,
) {
  const user = await db.user.create({ data: { name: `Teste ${role}`, email, role, status } });
  const actor: Actor = { kind: 'user', id: user.id, role, status, teamId: null };
  return { user, actor };
}

const tokenFrom = (url: string) => url.split('/convite/')[1]!;

beforeEach(async () => {
  await resetTestData(db);
  sent.length = 0;
  emailFails = false;
  clock.set(new Date('2026-10-13T12:00:00Z'));
  vi.clearAllMocks();
});

afterAll(() => closeTestDb());

describe('convite de usuários', () => {
  it('ADMIN convida: cria usuário INVITED, guarda só o hash do token, audita e envia e-mail', async () => {
    const { actor, user: admin } = await createUser('ADMIN', 'admin@example.com');
    const result = await inviteUser(deps, actor, {
      name: '  Ana Souza ',
      email: 'ANA@Example.com',
      role: 'SDR',
    });

    expect(result.emailSent).toBe(true);
    expect(result.email).toBe('ana@example.com');
    const invited = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(invited).toMatchObject({ name: 'Ana Souza', role: 'SDR', status: 'INVITED' });

    const token = tokenFrom(result.inviteUrl);
    const invitation = await db.invitation.findFirstOrThrow({ where: { userId: result.userId } });
    expect(invitation.tokenHash).toBe(hashToken(token));
    expect(invitation.tokenHash).not.toContain(token);
    expect(invitation.expiresAt.getTime() - clock.now().getTime()).toBe(INVITATION_TTL_MS);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'ana@example.com', category: 'invitation' });
    expect(sent[0]!.text).toContain(result.inviteUrl);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'user.invited' } });
    expect(audit).toMatchObject({ actorType: 'USER', actorId: admin.id, entityId: result.userId });
  });

  it('SDR não pode convidar; a tentativa é negada e auditada', async () => {
    const { actor, user } = await createUser('SDR', 'sdr@example.com');
    await expect(
      inviteUser(deps, actor, { name: 'Bruno Lima', email: 'bruno@example.com', role: 'ADMIN' }),
    ).rejects.toThrow(ForbiddenError);
    expect(await db.user.count({ where: { email: 'bruno@example.com' } })).toBe(0);
    const denied = await db.auditLog.findFirstOrThrow({ where: { action: 'access.denied' } });
    expect(denied).toMatchObject({ actorId: user.id, entityId: 'identity.inviteUser' });
    expect(denied.metadata).toEqual({ required: 'user.manage' });
  });

  it('recusa e-mail duplicado e dados inválidos', async () => {
    const { actor } = await createUser('ADMIN', 'admin@example.com');
    await inviteUser(deps, actor, { name: 'Ana Souza', email: 'ana@example.com', role: 'SDR' });
    await expect(
      inviteUser(deps, actor, { name: 'Ana S', email: 'ana@example.com', role: 'SDR' }),
    ).rejects.toThrow(ConflictError);
    await expect(
      inviteUser(deps, actor, { name: 'A', email: 'não-é-email', role: 'SDR' }),
    ).rejects.toThrow(ValidationError);
  });

  it('se o e-mail falhar, o convite continua válido e a falha é registrada', async () => {
    const { actor } = await createUser('ADMIN', 'admin@example.com');
    emailFails = true;
    const result = await inviteUser(deps, actor, {
      name: 'Ana Souza',
      email: 'ana@example.com',
      role: 'SDR',
    });
    expect(result.emailSent).toBe(false);
    expect(await db.invitation.count()).toBe(1);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('CLI (ator de sistema) pode criar o primeiro administrador', async () => {
    const result = await inviteUser(
      deps,
      { kind: 'system', name: 'admin:create' },
      {
        name: 'Primeira Admin',
        email: 'primeira@example.com',
        role: 'ADMIN',
      },
    );
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'user.invited' } });
    expect(audit).toMatchObject({
      actorType: 'SYSTEM',
      actorId: null,
      metadata: { system: 'admin:create' },
    });
    expect(result.userId).toBeTruthy();
  });
});

describe('aceite de convite', () => {
  async function invite() {
    const { actor } = await createUser('ADMIN', 'admin@example.com');
    const result = await inviteUser(deps, actor, {
      name: 'Ana Souza',
      email: 'ana@example.com',
      role: 'SDR',
    });
    return { admin: actor, result, token: tokenFrom(result.inviteUrl) };
  }

  it('define a senha, ativa o usuário e consome o token', async () => {
    const { result, token } = await invite();
    const accepted = await acceptInvitation(
      deps,
      { kind: 'anonymous' },
      { token, password: STRONG_PASSWORD },
    );
    expect(accepted).toEqual({ userId: result.userId, email: 'ana@example.com' });

    const user = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user).toMatchObject({ status: 'ACTIVE', emailVerified: true });
    const account = await db.account.findFirstOrThrow({ where: { userId: result.userId } });
    expect(account).toMatchObject({ providerId: 'credential', accountId: result.userId });
    expect(account.password).toBe(`hashed:${STRONG_PASSWORD}`);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'user.invitation_accepted' },
    });
    expect(audit).toMatchObject({ actorType: 'USER', actorId: result.userId });

    await expect(
      acceptInvitation(deps, { kind: 'anonymous' }, { token, password: STRONG_PASSWORD }),
    ).rejects.toThrow(NotFoundError);
  });

  it('recusa convite expirado', async () => {
    const { token } = await invite();
    clock.advance(INVITATION_TTL_MS + 1);
    await expect(
      acceptInvitation(deps, { kind: 'anonymous' }, { token, password: STRONG_PASSWORD }),
    ).rejects.toThrow(/Convite inválido ou expirado/);
  });

  it('recusa senha fraca sem alterar nada (transação desfeita)', async () => {
    const { result, token } = await invite();
    await expect(
      acceptInvitation(deps, { kind: 'anonymous' }, { token, password: 'curta' }),
    ).rejects.toThrow(ValidationError);
    const user = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.status).toBe('INVITED');
    expect(await db.account.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'user.invitation_accepted' } })).toBe(0);
  });

  it('reenviar invalida o link anterior', async () => {
    const { admin, result, token: oldToken } = await invite();
    const resent = await resendInvitation(deps, admin, { userId: result.userId });
    await expect(
      acceptInvitation(deps, { kind: 'anonymous' }, { token: oldToken, password: STRONG_PASSWORD }),
    ).rejects.toThrow(NotFoundError);
    await acceptInvitation(
      deps,
      { kind: 'anonymous' },
      { token: tokenFrom(resent.inviteUrl), password: STRONG_PASSWORD },
    );
    await expect(resendInvitation(deps, admin, { userId: result.userId })).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('token inexistente devolve a mesma mensagem genérica', async () => {
    await expect(
      acceptInvitation(
        deps,
        { kind: 'anonymous' },
        { token: 'x'.repeat(43), password: STRONG_PASSWORD },
      ),
    ).rejects.toThrow(/Convite inválido ou expirado/);
  });
});

describe('gestão de usuários', () => {
  it('altera o perfil com auditoria do antes/depois', async () => {
    const { actor } = await createUser('ADMIN', 'admin@example.com');
    const { user: sdr } = await createUser('SDR', 'sdr@example.com');
    const updated = await changeUserRole(deps, actor, { userId: sdr.id, role: 'MANAGER' });
    expect(updated.role).toBe('MANAGER');
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'user.role_changed' } });
    expect(audit.changes).toEqual({ role: ['SDR', 'MANAGER'] });
  });

  it('impede alterar o próprio perfil e remover o último administrador', async () => {
    const { actor, user: admin } = await createUser('ADMIN', 'admin@example.com');
    await expect(changeUserRole(deps, actor, { userId: admin.id, role: 'SDR' })).rejects.toThrow(
      /seu próprio perfil/,
    );
    await expect(
      changeUserRole(deps, { kind: 'system', name: 'test' }, { userId: admin.id, role: 'SDR' }),
    ).rejects.toThrow(/pelo menos um administrador/);
    await expect(
      setUserStatus(
        deps,
        { kind: 'system', name: 'test' },
        { userId: admin.id, status: 'INACTIVE' },
      ),
    ).rejects.toThrow(/pelo menos um administrador/);
  });

  it('desativar revoga as sessões e bloqueia o acesso imediatamente', async () => {
    const { actor } = await createUser('ADMIN', 'admin@example.com');
    const { user: sdr } = await createUser('SDR', 'sdr@example.com');
    await db.session.create({
      data: { userId: sdr.id, token: 'sessao-1', expiresAt: new Date('2026-12-01T00:00:00Z') },
    });

    await setUserStatus(deps, actor, { userId: sdr.id, status: 'INACTIVE' });
    expect(await db.session.count({ where: { userId: sdr.id } })).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'user.status_changed' } });
    expect(audit.metadata).toEqual({ revokedSessions: 1 });

    const sdrActor = await resolveActor(db, sdr.id);
    expect(sdrActor).toMatchObject({ kind: 'user', status: 'INACTIVE' });
    await expect(getCurrentUser(deps, sdrActor!, {})).rejects.toThrow(UnauthenticatedError);
  });

  it('ADMIN redefine a 2FA de quem perdeu o celular: segredo apagado, sessões encerradas, auditado', async () => {
    const { actor } = await createUser('ADMIN', 'admin@example.com');
    const { actor: managerActor, user: manager } = await createUser(
      'MANAGER',
      'gestor@example.com',
    );
    await db.user.update({ where: { id: manager.id }, data: { twoFactorEnabled: true } });
    await db.twoFactor.create({
      data: { userId: manager.id, secret: 'cifrado', backupCodes: 'cifrados' },
    });
    await db.session.create({
      data: {
        userId: manager.id,
        token: 'sessao-2fa',
        expiresAt: new Date('2026-12-01T00:00:00Z'),
      },
    });

    await expect(resetUserTwoFactor(deps, managerActor, { userId: manager.id })).rejects.toThrow(
      ForbiddenError,
    );
    const updated = await resetUserTwoFactor(deps, actor, { userId: manager.id });
    expect(updated.twoFactorEnabled).toBe(false);
    expect(await db.twoFactor.count()).toBe(0);
    expect(await db.session.count({ where: { userId: manager.id } })).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'user.2fa_reset' } });
    expect(audit).toMatchObject({ entityId: manager.id, metadata: { revokedSessions: 1 } });

    // Sem 2FA ativa, não há o que redefinir.
    await expect(resetUserTwoFactor(deps, actor, { userId: manager.id })).rejects.toThrow(
      BusinessRuleError,
    );
  });

  it('lista usuários com filtros e devolve permissões do usuário atual', async () => {
    const { actor } = await createUser('ADMIN', 'admin@example.com');
    await createUser('SDR', 'sdr@example.com');
    const sdrs = await listUsers(deps, actor, { role: 'SDR' });
    expect(sdrs.map((u) => u.email)).toEqual(['sdr@example.com']);
    expect(sdrs[0]).not.toHaveProperty('password');
    const found = await listUsers(deps, actor, { q: 'ADMIN@' });
    expect(found).toHaveLength(1);

    const me = await getCurrentUser(deps, actor, {});
    expect(me.permissions).toContain('user.manage');
  });
});

describe('auditoria e login', () => {
  it('registra login com sucesso e falha (e-mail mascarado)', async () => {
    const { user } = await createUser('SDR', 'sdr@example.com');
    await recordSignIn(db, { ip: '10.0.0.9' }, { success: true, userId: user.id });
    await recordSignIn(
      db,
      {},
      { success: false, email: 'sdr@example.com', reason: 'INVALID_CREDENTIALS' },
    );

    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt,
    ).not.toBeNull();
    const ok = await db.auditLog.findFirstOrThrow({ where: { action: 'auth.login' } });
    expect(ok).toMatchObject({ actorType: 'USER', actorId: user.id, ip: '10.0.0.9' });
    const failed = await db.auditLog.findFirstOrThrow({ where: { action: 'auth.login_failed' } });
    expect(failed.metadata).toEqual({ email: 's***@example.com', reason: 'INVALID_CREDENTIALS' });
  });

  it('ADMIN consulta a auditoria paginada; SDR não', async () => {
    const { actor } = await createUser('ADMIN', 'admin@example.com');
    const { actor: sdr } = await createUser('SDR', 'sdr@example.com');
    for (let i = 0; i < 5; i++) {
      await inviteUser(deps, actor, {
        name: `Pessoa ${i}`,
        email: `p${i}@example.com`,
        role: 'SALES',
      });
    }
    const page1 = await listAuditLogs(deps, actor, { action: 'user.invited', limit: 3 });
    expect(page1.data).toHaveLength(3);
    expect(page1.data[0]!.actorName).toBe('Teste ADMIN');
    const page2 = await listAuditLogs(deps, actor, {
      action: 'user.invited',
      limit: 3,
      cursor: page1.nextCursor!,
    });
    expect(page2.data).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.data, ...page2.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(5);

    await expect(listAuditLogs(deps, sdr, {})).rejects.toThrow(ForbiddenError);
  });
});
