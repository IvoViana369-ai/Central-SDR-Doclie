import { moveLeadStage } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Move o lead de etapa: `stageId`, `version` lida (edição concorrente → 409),
 * `lossReasonId` nas etapas de perda e `note` opcional.
 */
export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params, body }) =>
  moveLeadStage(deps, actor, { ...((await body()) as object), leadId: params.id } as never, meta),
);
