import type { MetricDimension, Prisma } from '@docline/db';
import { ValidationError } from '../../../shared/errors';
import { defineUseCase } from '../../../shared/use-case';
import { biDailyMetricsInput, biEventsInput } from '../contracts/schemas';
import { WEBHOOK_TEST_EVENT } from '../domain/webhooks';

/**
 * Eventos só saem depois de 60 s: uma transação dura no máximo 15 s, então
 * nenhum evento com id menor que o último exportado pode aparecer depois
 * (o cursor por id não pula nada).
 */
const SETTLE_MS = 60_000;

/** Para o BI, sem os valores mascarados da Lista Não Contatar. */
function biPayload(payload: Prisma.JsonValue): Prisma.JsonValue {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const data = payload as Record<string, Prisma.JsonValue>;
  if (!Array.isArray(data.suppressions)) return payload;
  return {
    ...data,
    suppressions: data.suppressions.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const { valueMasked: _masked, ...rest } = entry as Record<string, Prisma.JsonValue>;
      return rest;
    }),
  };
}

/**
 * Exportação incremental de eventos para o BI (F12-06): os mesmos eventos dos
 * webhooks, em ordem, a partir do último id lido (`after`). Retenção de 90 dias.
 */
export const exportBiEvents = defineUseCase({
  name: 'integrations.exportBiEvents',
  access: 'bi.export',
  input: biEventsInput,
  async run(ctx, input) {
    const rows = await ctx.tx.outboundEvent.findMany({
      where: {
        type: input.types ? { in: input.types } : { not: WEBHOOK_TEST_EVENT },
        createdAt: { lt: new Date(ctx.now.getTime() - SETTLE_MS) },
        ...(input.after ? { id: { gt: input.after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: input.limit,
      select: { id: true, type: true, occurredAt: true, leadId: true, payload: true },
    });
    return {
      data: rows.map((row) => ({ ...row, payload: biPayload(row.payload) })),
      /** Passe no próximo pedido como `after`; igual ao enviado quando não há nada novo. */
      cursor: rows.at(-1)?.id ?? input.after ?? null,
      hasMore: rows.length === input.limit,
    };
  },
});

function encodeCursor(computedAt: Date, date: Date): string {
  return Buffer.from(`${computedAt.toISOString()}|${date.toISOString().slice(0, 10)}`).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { computedAt: Date; date: Date } {
  const [computedAt, date] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const parsed = { computedAt: new Date(computedAt ?? ''), date: new Date(date ?? '') };
  if (Number.isNaN(parsed.computedAt.getTime()) || Number.isNaN(parsed.date.getTime())) {
    throw new ValidationError([{ path: 'cursor', message: 'Cursor inválido.' }]);
  }
  return parsed;
}

/**
 * Indicadores diários incrementais (F12-06): os dias recalculados desde o
 * último cursor, cada um inteiro (substitua o dia no BI). Só contagens por
 * dia, equipe, pessoa (id) e canal; nenhum dado de lead.
 */
export const exportBiDailyMetrics = defineUseCase({
  name: 'integrations.exportBiDailyMetrics',
  access: 'bi.export',
  input: biDailyMetricsInput,
  async run(ctx, input) {
    const since = input.cursor ? decodeCursor(input.cursor) : null;
    const days = await ctx.tx.$queryRaw<{ date: Date; computed_at: Date }[]>`
      SELECT date, max(computed_at) AS computed_at
      FROM daily_metrics
      GROUP BY date
      HAVING ${since === null}
        OR (max(computed_at), date) > (${since?.computedAt ?? null}::timestamptz, ${since?.date ?? null}::date)
      ORDER BY 2, 1
      LIMIT ${input.limit}`;
    const rows =
      days.length === 0
        ? []
        : await ctx.tx.dailyMetric.findMany({
            where: {
              date: { in: days.map((d) => d.date) },
              ...(input.dimension ? { dimension: input.dimension as MetricDimension } : {}),
            },
            orderBy: [{ date: 'asc' }, { dimension: 'asc' }, { dimensionId: 'asc' }],
          });
    const last = days.at(-1);
    return {
      days: days.map((day) => {
        const date = day.date.toISOString().slice(0, 10);
        return {
          date,
          computedAt: day.computed_at,
          rows: rows
            .filter((r) => r.date.toISOString().slice(0, 10) === date)
            .map(({ date: _date, computedAt: _computed, ...metrics }) => metrics),
        };
      }),
      cursor: last ? encodeCursor(last.computed_at, last.date) : (input.cursor ?? null),
      hasMore: days.length === input.limit,
    };
  },
});
