import { newId, type DbTransaction } from '@docline/db';
import { JOBS } from '../../../jobs/catalog';
import { toJson, type UseCaseContext } from '../../../shared/use-case';

export interface OutboundEventInput {
  type: string;
  /** Lead do evento, quando há (anonimização e exportação para BI). */
  leadId?: string | null;
  /** Só ids, códigos e valores mascarados (docs/INTEGRATIONS.md §11.2). */
  data: Record<string, unknown>;
}

type PublishContext = Pick<UseCaseContext, 'tx' | 'now' | 'afterCommit' | 'deps'>;

/**
 * Outbox (F12-02, ADR 035): grava os eventos na MESMA transação da mudança de
 * negócio e cria uma entrega para cada destino que assina o tipo (pausados e
 * desligados também: recebem quando voltarem). Depois do commit, pede o envio
 * ao worker; o job de minuto em minuto cobre qualquer falha nesse pedido.
 */
export async function publishEvents(
  ctx: PublishContext,
  events: OutboundEventInput[],
): Promise<string[]> {
  if (events.length === 0) return [];
  const rows = events.map((event) => ({
    id: newId(),
    type: event.type,
    occurredAt: ctx.now,
    leadId: event.leadId ?? null,
    payload: toJson(event.data),
    createdAt: ctx.now,
  }));
  await ctx.tx.outboundEvent.createMany({ data: rows });

  const types = [...new Set(rows.map((row) => row.type))];
  const endpoints = await ctx.tx.webhookEndpoint.findMany({
    where: { events: { hasSome: types } },
    select: { id: true, events: true, status: true },
  });
  const deliveries = rows.flatMap((row) =>
    endpoints
      .filter((endpoint) => endpoint.events.includes(row.type))
      .map((endpoint) => ({
        id: newId(),
        endpointId: endpoint.id,
        eventId: row.id,
        nextAttemptAt: ctx.now,
        createdAt: ctx.now,
      })),
  );
  if (deliveries.length > 0) {
    await ctx.tx.webhookDelivery.createMany({ data: deliveries });
    const active = new Set(endpoints.filter((e) => e.status === 'ACTIVE').map((e) => e.id));
    if (deliveries.some((d) => active.has(d.endpointId))) {
      ctx.afterCommit(async () => {
        await ctx.deps.jobs.enqueue(JOBS.webhooksDispatch.name, {}, { singletonKey: 'webhooks' });
      });
    }
  }
  return rows.map((row) => row.id);
}

/** Mesmo formato de `formatLeadCode` (leads), sem importar o módulo (evita ciclo). */
export function leadCodeLabel(code: number): string {
  return `L-${String(code).padStart(6, '0')}`;
}

export interface EventLead {
  id: string;
  code: string;
  /** Ids do lead em outros sistemas Docline (ex.: no CRM). */
  references: { system: string; externalId: string }[];
}

/** Leads como aparecem nos eventos: id, código e referências externas. */
export async function eventLeads(tx: DbTransaction, leadIds: string[]): Promise<EventLead[]> {
  if (leadIds.length === 0) return [];
  const [leads, references] = await Promise.all([
    tx.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, code: true } }),
    tx.externalReference.findMany({
      where: { entityType: 'LEAD', entityId: { in: leadIds } },
      select: { entityId: true, system: true, externalId: true },
      orderBy: { system: 'asc' },
    }),
  ]);
  return leads.map((lead) => ({
    id: lead.id,
    code: leadCodeLabel(lead.code),
    references: references
      .filter((r) => r.entityId === lead.id)
      .map((r) => ({ system: r.system, externalId: r.externalId })),
  }));
}

/** Referências externas de uma oportunidade. */
export async function opportunityReferences(tx: DbTransaction, opportunityId: string) {
  return tx.externalReference.findMany({
    where: { entityType: 'OPPORTUNITY', entityId: opportunityId },
    select: { system: true, externalId: true },
    orderBy: { system: 'asc' },
  });
}
