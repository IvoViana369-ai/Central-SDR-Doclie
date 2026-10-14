import { updateUserAvailability } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Disponibilidade para a distribuição automática ({ autoAssign, maxActiveLeads,
 * awayUntil }; só os campos enviados mudam). ADMIN e GESTOR.
 */
export const PATCH = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  updateUserAvailability(
    deps,
    actor,
    { ...((await body()) as object), userId: params.id } as never,
    meta,
  ),
);
