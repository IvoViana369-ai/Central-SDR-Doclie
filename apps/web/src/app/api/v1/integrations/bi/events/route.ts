import { exportBiEvents } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Exportação incremental de eventos para o BI (F12-06): ?after=<último id>
 * &limit=&types=lead.converted,opportunity.lost. Chave com `bi:read`.
 */
export const GET = apiHandler(
  async ({ deps, actor, meta, query }) => {
    const { after, limit, types } = query();
    return exportBiEvents(
      deps,
      actor,
      {
        after: after || undefined,
        limit: (limit || undefined) as never,
        types: (types || undefined) as never,
      },
      meta,
    );
  },
  { apiKey: 'bi:read' },
);
