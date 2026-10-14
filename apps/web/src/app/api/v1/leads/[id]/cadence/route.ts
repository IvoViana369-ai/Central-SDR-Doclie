import { enrollLead, getLeadCadence } from '@docline/core';
import { apiHandler } from '@/server/api';

/** Inscrições do lead (a em andamento primeiro). */
export const GET = apiHandler<{ id: string }>(async ({ deps, actor, meta, params }) => ({
  data: await getLeadCadence(deps, actor, { leadId: params.id }, meta),
}));

/** Inscrever na cadência (`cadenceId` opcional: padrão). */
export const POST = apiHandler<{ id: string }>(
  async ({ deps, actor, meta, params, body }) =>
    enrollLead(deps, actor, { ...((await body()) as object), leadId: params.id } as never, meta),
  { status: 201 },
);
