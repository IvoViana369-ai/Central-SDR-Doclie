import { listSavedViews, saveView } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(async ({ deps, actor, meta }) => ({
  data: await listSavedViews(deps, actor, {}, meta),
}));

export const POST = apiHandler(
  async ({ deps, actor, meta, body }) => saveView(deps, actor, (await body()) as never, meta),
  { status: 201 },
);
