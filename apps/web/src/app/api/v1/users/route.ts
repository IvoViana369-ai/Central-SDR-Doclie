import { inviteUser, listUsers, type InviteUserInput, type ListUsersInput } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(async ({ deps, actor, meta, query }) => ({
  data: await listUsers(deps, actor, query() as ListUsersInput, meta),
}));

export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => {
    const result = await inviteUser(deps, actor, (await body()) as InviteUserInput, meta);
    // O link do convite vai só por e-mail; nunca é devolvido à interface.
    return {
      userId: result.userId,
      email: result.email,
      expiresAt: result.expiresAt,
      emailSent: result.emailSent,
    };
  },
  { status: 201 },
);
