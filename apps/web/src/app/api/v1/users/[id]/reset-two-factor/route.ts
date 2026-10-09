import { resetUserTwoFactor } from '@docline/core';
import { apiHandler } from '@/server/api';

/** ADMIN redefine a 2FA de quem perdeu o celular e os códigos de recuperação. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  resetUserTwoFactor(deps, actor, { userId: params.id }, meta),
);
