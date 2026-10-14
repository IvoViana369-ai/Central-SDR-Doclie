import { assertAccess } from '@docline/core';
import { integrationStatuses } from '@docline/integrations';
import { apiHandler } from '@/server/api';
import { getContainer } from '@/server/container';

export const GET = apiHandler(async ({ deps, actor, meta }) => {
  await assertAccess(deps, actor, 'integration.manage', 'integrations', meta);
  return { data: integrationStatuses(getContainer().env) };
});
