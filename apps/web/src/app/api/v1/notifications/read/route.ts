import { markNotificationsRead } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Marca como lidos os avisos informados (`ids`) ou todos. */
export const POST = apiHandler(async ({ deps, actor, meta, body }) =>
  markNotificationsRead(deps, actor, (await body()) as never, meta),
);
