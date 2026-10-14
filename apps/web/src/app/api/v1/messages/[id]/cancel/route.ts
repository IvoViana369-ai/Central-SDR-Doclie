import { cancelAssistedMessage } from '@docline/core';
import { apiHandler } from '@/server/api';

export const POST = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) =>
  cancelAssistedMessage(deps, actor, { messageId: params.id }, meta),
);
