import type { Channel } from '@docline/db';
import { JOBS } from '../../../jobs/catalog';
import { toJson, type AuditChanges, type UseCaseContext } from '../../../shared/use-case';
import type { LeadEventType } from '../domain/events';

/** Grava um evento na timeline do lead, na transação do caso de uso. */
export async function recordLeadEvent(
  ctx: UseCaseContext,
  leadId: string,
  type: LeadEventType,
  options: {
    payload?: Record<string, unknown>;
    subject?: { type: string; id: string };
    channel?: Channel;
  } = {},
): Promise<void> {
  await ctx.tx.leadEvent.create({
    data: {
      leadId,
      type,
      occurredAt: ctx.now,
      actorType: ctx.actor.kind === 'user' ? 'USER' : 'SYSTEM',
      actorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      ...(options.payload ? { payload: toJson(options.payload) } : {}),
      subjectType: options.subject?.type ?? null,
      subjectId: options.subject?.id ?? null,
      channel: options.channel ?? null,
    },
  });
}

/**
 * Auditoria de qualquer alteração ligada a um lead. Tudo usa `entityType = lead`
 * e `entityId = id do lead`, o que permite montar o histórico do lead com uma
 * única consulta; o item afetado (pessoa, contato…) vai em `metadata.subjectId`.
 */
export async function auditLead(
  ctx: UseCaseContext,
  leadId: string,
  action: string,
  options: { changes?: AuditChanges; subjectId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await ctx.audit({
    action,
    entityType: 'lead',
    entityId: leadId,
    changes: options.changes && Object.keys(options.changes).length > 0 ? options.changes : null,
    metadata:
      options.subjectId || options.metadata
        ? { ...(options.subjectId ? { subjectId: options.subjectId } : {}), ...options.metadata }
        : null,
  });
}

/** Marca atividade recente no lead (ordenação "mexidos recentemente"). */
export async function touchLead(ctx: UseCaseContext, leadId: string): Promise<void> {
  await ctx.tx.lead.update({ where: { id: leadId }, data: { lastActivityAt: ctx.now } });
}

/**
 * Agenda a busca de duplicados do lead (job `dedup.check-lead`), na mesma
 * transação: se a alteração for desfeita, o job também é.
 */
export async function queueDuplicateCheck(ctx: UseCaseContext, leadId: string): Promise<void> {
  await ctx.deps.jobs.enqueue(
    JOBS.dedupCheckLead.name,
    { leadIds: [leadId], source: 'MANUAL' },
    { tx: ctx.tx },
  );
}
