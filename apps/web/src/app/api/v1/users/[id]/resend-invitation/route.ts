import { resendInvitation } from '@docline/core';
import { apiHandler } from '@/server/api';

export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) => {
  const result = await resendInvitation(deps, actor, { userId: params.id }, meta);
  return {
    userId: result.userId,
    email: result.email,
    expiresAt: result.expiresAt,
    emailSent: result.emailSent,
  };
});
