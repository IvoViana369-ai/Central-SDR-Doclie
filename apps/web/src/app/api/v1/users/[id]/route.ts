import { changeUserRole, setUserStatus, ValidationError } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Altera perfil ({ role }) ou status ({ status }) — um por vez. */
export const PATCH = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) => {
  const input = (await body()) as { role?: unknown; status?: unknown };
  if (input.role !== undefined && input.status === undefined) {
    return changeUserRole(deps, actor, { userId: params.id, role: input.role as never }, meta);
  }
  if (input.status !== undefined && input.role === undefined) {
    return setUserStatus(deps, actor, { userId: params.id, status: input.status as never }, meta);
  }
  throw new ValidationError([{ path: '', message: 'Informe "role" ou "status" (um por vez).' }]);
});
