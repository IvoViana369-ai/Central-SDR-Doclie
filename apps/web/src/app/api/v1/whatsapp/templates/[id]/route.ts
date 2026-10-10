import { updateWhatsappTemplate } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Abordagem do modelo e se os SDRs podem usá-lo (ADMIN). */
export const PATCH = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  updateWhatsappTemplate(
    deps,
    actor,
    { ...((await body()) as object), templateId: params.id } as never,
    meta,
  ),
);
