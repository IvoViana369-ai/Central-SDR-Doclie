import { mergeDuplicate } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Mesclar: `survivorId`, `choices` campo a campo, `versions` lidas e `note`. */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  mergeDuplicate(
    deps,
    actor,
    { ...((await body()) as object), candidateId: params.id } as never,
    meta,
  ),
);
