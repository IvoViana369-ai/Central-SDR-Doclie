import { listAuditLogs, type ListAuditLogsInput } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(({ deps, actor, meta, query }) =>
  listAuditLogs(deps, actor, query() as ListAuditLogsInput, meta),
);
