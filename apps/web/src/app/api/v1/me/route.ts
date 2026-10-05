import { getCurrentUser } from '@docline/core';
import { apiHandler } from '@/server/api';

export const GET = apiHandler(({ deps, actor, meta }) => getCurrentUser(deps, actor, {}, meta));
