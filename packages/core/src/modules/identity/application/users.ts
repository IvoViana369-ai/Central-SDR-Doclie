import { BusinessRuleError } from '../../../shared/errors';
import { diffFields } from '../../../shared/diff';
import { defineUseCase } from '../../../shared/use-case';
import { permissionsOf } from '../domain/permissions';
import {
  changeUserRoleInput,
  listUsersInput,
  setUserStatusInput,
  userIdInput,
} from '../contracts/schemas';
import {
  countActiveAdmins,
  getUserOrThrow,
  lockAdminChanges,
  publicUserSelect,
} from '../infra/users';
import { z } from 'zod';

export const listUsers = defineUseCase({
  name: 'identity.listUsers',
  access: 'user.read',
  input: listUsersInput,
  async run(ctx, input) {
    return ctx.tx.user.findMany({
      where: {
        status: input.status,
        role: input.role,
        ...(input.q
          ? {
              OR: [
                { name: { contains: input.q, mode: 'insensitive' } },
                { email: { contains: input.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: publicUserSelect,
      orderBy: [{ name: 'asc' }],
      take: 500,
    });
  },
});

/** Dados do usuário logado e suas permissões efetivas (usado pela UI). */
export const getCurrentUser = defineUseCase({
  name: 'identity.getCurrentUser',
  access: 'authenticated',
  input: z.object({}),
  async run(ctx) {
    if (ctx.actor.kind !== 'user') throw new BusinessRuleError('Disponível apenas para usuários.');
    const user = await getUserOrThrow(ctx.tx, ctx.actor.id);
    return { ...user, permissions: permissionsOf(user.role) };
  },
});

export const changeUserRole = defineUseCase({
  name: 'identity.changeUserRole',
  access: 'user.manage',
  input: changeUserRoleInput,
  async run(ctx, input) {
    if (ctx.actor.kind === 'user' && ctx.actor.id === input.userId) {
      throw new BusinessRuleError('Você não pode alterar o seu próprio perfil.');
    }
    await lockAdminChanges(ctx.tx);
    const user = await getUserOrThrow(ctx.tx, input.userId);
    if (user.role === input.role) return user;
    if (
      user.role === 'ADMIN' &&
      user.status === 'ACTIVE' &&
      (await countActiveAdmins(ctx.tx)) <= 1
    ) {
      throw new BusinessRuleError('O sistema precisa de pelo menos um administrador ativo.');
    }
    const updated = await ctx.tx.user.update({
      where: { id: user.id },
      data: { role: input.role },
      select: publicUserSelect,
    });
    await ctx.audit({
      action: 'user.role_changed',
      entityType: 'user',
      entityId: user.id,
      changes: diffFields(user, updated, ['role']),
    });
    return updated;
  },
});

/** Ativa ou desativa. Desativar revoga todas as sessões imediatamente. */
export const setUserStatus = defineUseCase({
  name: 'identity.setUserStatus',
  access: 'user.manage',
  input: setUserStatusInput,
  async run(ctx, input) {
    if (ctx.actor.kind === 'user' && ctx.actor.id === input.userId) {
      throw new BusinessRuleError('Você não pode alterar o status do seu próprio usuário.');
    }
    await lockAdminChanges(ctx.tx);
    const user = await getUserOrThrow(ctx.tx, input.userId);
    if (user.status === 'INVITED') {
      throw new BusinessRuleError(
        'Usuário convidado ainda não ativou o acesso; reenvie ou aguarde o convite.',
      );
    }
    if (user.status === input.status) return user;
    if (
      input.status === 'INACTIVE' &&
      user.role === 'ADMIN' &&
      (await countActiveAdmins(ctx.tx)) <= 1
    ) {
      throw new BusinessRuleError('O sistema precisa de pelo menos um administrador ativo.');
    }
    const updated = await ctx.tx.user.update({
      where: { id: user.id },
      data: { status: input.status },
      select: publicUserSelect,
    });
    let revokedSessions = 0;
    if (input.status === 'INACTIVE') {
      revokedSessions = (await ctx.tx.session.deleteMany({ where: { userId: user.id } })).count;
    }
    await ctx.audit({
      action: 'user.status_changed',
      entityType: 'user',
      entityId: user.id,
      changes: diffFields(user, updated, ['status']),
      metadata: input.status === 'INACTIVE' ? { revokedSessions } : null,
    });
    return updated;
  },
});

/**
 * Redefine a verificação em duas etapas de quem perdeu o celular e os códigos
 * de recuperação (ADMIN). Apaga o segredo, encerra as sessões e fica
 * auditado; a pessoa entra só com a senha e ativa a 2FA de novo.
 */
export const resetUserTwoFactor = defineUseCase({
  name: 'identity.resetUserTwoFactor',
  access: 'user.manage',
  input: userIdInput,
  async run(ctx, input) {
    if (ctx.actor.kind === 'user' && ctx.actor.id === input.userId) {
      throw new BusinessRuleError('Para a sua própria conta, use "Minha conta".');
    }
    const user = await getUserOrThrow(ctx.tx, input.userId);
    if (!user.twoFactorEnabled) {
      throw new BusinessRuleError(`${user.name} não usa verificação em duas etapas.`);
    }
    await ctx.tx.twoFactor.deleteMany({ where: { userId: user.id } });
    const updated = await ctx.tx.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false },
      select: publicUserSelect,
    });
    const revokedSessions = (await ctx.tx.session.deleteMany({ where: { userId: user.id } })).count;
    await ctx.audit({
      action: 'user.2fa_reset',
      entityType: 'user',
      entityId: user.id,
      metadata: { revokedSessions },
    });
    return updated;
  },
});
