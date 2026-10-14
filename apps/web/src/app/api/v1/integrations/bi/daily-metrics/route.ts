import { exportBiDailyMetrics } from '@docline/core';
import { apiHandler } from '@/server/api';

/**
 * Indicadores diários incrementais para o BI (F12-06): os dias recalculados
 * desde o cursor, cada um inteiro. ?cursor=&limit=&dimension=GLOBAL|SDR|CHANNEL.
 * Chave com `bi:read`.
 */
export const GET = apiHandler(
  async ({ deps, actor, meta, query }) => {
    const { cursor, limit, dimension } = query();
    return exportBiDailyMetrics(
      deps,
      actor,
      {
        cursor: cursor || undefined,
        limit: (limit || undefined) as never,
        dimension: (dimension || undefined) as never,
      },
      meta,
    );
  },
  { apiKey: 'bi:read' },
);
