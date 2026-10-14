import { revokeApiKey } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Revoga na hora, com motivo ({ reason }). */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  revokeApiKey(deps, actor, { ...((await body()) as object), apiKeyId: params.id } as never, meta),
);
