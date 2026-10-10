import { ConflictError, BusinessRuleError, NotFoundError } from '../../../shared/errors';
import { generateToken, hashToken } from '../../../shared/tokens';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { assertPasswordPolicy } from '../domain/password-policy';
import { acceptInvitationInput, inviteUserInput, userIdInput } from '../contracts/schemas';
import { getUserOrThrow, publicUserSelect } from '../infra/users';
import { invitationEmail } from './emails';

/** Validade do link de convite (docs/SECURITY.md §3). */
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

export interface InvitationResult {
  userId: string;
  email: string;
  expiresAt: Date;
  /** Link de convite. Exibido apenas pela CLI de bootstrap; a UI depende do e-mail. */
  inviteUrl: string;
  /** Preenchido após o commit: o e-mail foi aceito pelo provedor? */
  emailSent: boolean;
}

async function issueInvitation(
  ctx: UseCaseContext,
  user: { id: string; name: string; email: string },
): Promise<InvitationResult> {
  const token = generateToken();
  const expiresAt = new Date(ctx.now.getTime() + INVITATION_TTL_MS);
  const createdById = ctx.actor.kind === 'user' ? ctx.actor.id : null;
  await ctx.tx.invitation.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt, createdById },
  });

  const inviteUrl = new URL(`/convite/${token}`, ctx.deps.appUrl).toString();
  const invitedBy = createdById
    ? await ctx.tx.user.findUnique({ where: { id: createdById }, select: { name: true } })
    : null;
  const result: InvitationResult = {
    userId: user.id,
    email: user.email,
    expiresAt,
    inviteUrl,
    emailSent: false,
  };
  ctx.afterCommit(async () => {
    await ctx.deps.email.send(
      invitationEmail({
        to: user.email,
        name: user.name,
        inviteUrl,
        invitedByName: invitedBy?.name ?? null,
        expiresAt,
      }),
    );
    result.emailSent = true;
  });
  return result;
}

/** ADMIN convida um usuário: cria o registro (INVITED) e envia o link para definir a senha. */
export const inviteUser = defineUseCase({
  name: 'identity.inviteUser',
  access: 'user.manage',
  input: inviteUserInput,
  async run(ctx, input) {
    const existing = await ctx.tx.user.findUnique({
      where: { email: input.email },
      select: { status: true },
    });
    if (existing) {
      throw new ConflictError(
        existing.status === 'INVITED'
          ? 'Este e-mail já tem um convite pendente. Use "Reenviar convite".'
          : 'Já existe um usuário com este e-mail.',
      );
    }
    if (input.teamId) {
      const team = await ctx.tx.team.findUnique({
        where: { id: input.teamId },
        select: { id: true },
      });
      if (!team) throw new NotFoundError('Equipe não encontrada.');
    }
    const user = await ctx.tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        teamId: input.teamId ?? null,
      },
      select: publicUserSelect,
    });
    await ctx.audit({
      action: 'user.invited',
      entityType: 'user',
      entityId: user.id,
      changes: { role: [null, user.role], status: [null, user.status] },
    });
    return issueInvitation(ctx, user);
  },
});

/** Gera um novo link (o anterior deixa de valer). Só para usuários ainda não ativados. */
export const resendInvitation = defineUseCase({
  name: 'identity.resendInvitation',
  access: 'user.manage',
  input: userIdInput,
  async run(ctx, input) {
    const user = await getUserOrThrow(ctx.tx, input.userId);
    if (user.status !== 'INVITED') {
      throw new BusinessRuleError(
        'Este usuário já ativou o acesso; convites só valem para novos usuários.',
      );
    }
    await ctx.tx.invitation.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      data: { revokedAt: ctx.now },
    });
    await ctx.audit({ action: 'user.invitation_resent', entityType: 'user', entityId: user.id });
    return issueInvitation(ctx, user);
  },
});

/** Mensagem única para qualquer token inválido (não revela se o e-mail existe). */
const INVALID_INVITATION = 'Convite inválido ou expirado. Peça um novo convite ao administrador.';

/** O convidado define a senha. Sem sessão: o token é a prova de posse do e-mail. */
export const acceptInvitation = defineUseCase({
  name: 'identity.acceptInvitation',
  access: 'public',
  input: acceptInvitationInput,
  async run(ctx, input) {
    const invitation = await ctx.tx.invitation.findUnique({
      where: { tokenHash: hashToken(input.token) },
      include: { user: { select: { id: true, email: true, status: true } } },
    });
    if (
      !invitation ||
      invitation.usedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= ctx.now ||
      invitation.user.status !== 'INVITED'
    ) {
      throw new NotFoundError(INVALID_INVITATION);
    }

    const { user } = invitation;
    assertPasswordPolicy(input.password, { email: user.email });
    const passwordHash = await ctx.deps.passwordHasher.hash(input.password);

    // Conta de credencial no formato do Better Auth (providerId "credential").
    await ctx.tx.account.upsert({
      where: { providerId_accountId: { providerId: 'credential', accountId: user.id } },
      create: {
        providerId: 'credential',
        accountId: user.id,
        userId: user.id,
        password: passwordHash,
      },
      update: { password: passwordHash },
    });
    await ctx.tx.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', emailVerified: true },
    });
    const consumed = await ctx.tx.invitation.updateMany({
      where: { id: invitation.id, usedAt: null },
      data: { usedAt: ctx.now },
    });
    if (consumed.count !== 1) throw new NotFoundError(INVALID_INVITATION);

    await ctx.audit({
      action: 'user.invitation_accepted',
      entityType: 'user',
      entityId: user.id,
      changes: { status: ['INVITED', 'ACTIVE'] },
      actorOverride: { type: 'USER', id: user.id },
    });
    return { userId: user.id, email: user.email };
  },
});
