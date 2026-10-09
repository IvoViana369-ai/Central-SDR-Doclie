import { removeLeadTag } from '@docline/core';
import { apiHandler } from '@/server/api';

export const DELETE = apiHandler<{ id: string; tagId: string }>(
  async ({ deps, actor, meta, params }) =>
    removeLeadTag(deps, actor, { leadId: params.id, tagId: params.tagId }, meta),
);
