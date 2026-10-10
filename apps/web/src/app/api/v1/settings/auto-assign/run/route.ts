import { requestAutoAssign } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Distribuir agora: o worker roda a distribuição sem esperar a próxima hora. */
export const POST = apiHandler(
  async ({ deps, actor, meta }) => requestAutoAssign(deps, actor, {}, meta),
  { status: 202 },
);
