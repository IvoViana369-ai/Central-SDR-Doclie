import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import {
  addContactPointInput,
  contactPointRefInput,
  updateContactPointInput,
} from '../contracts/schemas';
import { LEAD_EVENTS } from '../domain/events';
import { refreshLeadContactState } from '../../compliance';
import { auditLead, queueDuplicateCheck, recordLeadEvent, touchLead } from '../infra/events';
import { requireEditableLead } from '../infra/scope';
import { findDuplicateLeads } from './duplicates';
import { maskContactValue, normalizeContactValue } from './normalize-input';

async function requireContactPoint(ctx: UseCaseContext, leadId: string, contactPointId: string) {
  const cp = await ctx.tx.contactPoint.findFirst({
    where: { id: contactPointId, leadId, status: { not: 'REMOVED' } },
  });
  if (!cp) throw new NotFoundError('Contato não encontrado.');
  return cp;
}

async function requirePersonOfLead(ctx: UseCaseContext, leadId: string, personId: string) {
  const person = await ctx.tx.leadPerson.count({
    where: { id: personId, leadId, status: 'ACTIVE' },
  });
  if (person === 0) throw new ValidationError([{ path: 'personId', message: 'Pessoa inválida.' }]);
}

/** Um contato principal por tipo: ao marcar um, desmarca os outros do mesmo tipo. */
async function makePrimary(
  ctx: UseCaseContext,
  leadId: string,
  cp: { id: string; type: 'PHONE' | 'EMAIL' | 'INSTAGRAM' },
) {
  await ctx.tx.contactPoint.updateMany({
    where: { leadId, type: cp.type, isPrimary: true, id: { not: cp.id } },
    data: { isPrimary: false },
  });
  await ctx.tx.contactPoint.update({ where: { id: cp.id }, data: { isPrimary: true } });
}

/** Promove outro contato ativo do mesmo tipo quando o principal deixa de ser usável. */
async function ensurePrimary(
  ctx: UseCaseContext,
  leadId: string,
  type: 'PHONE' | 'EMAIL' | 'INSTAGRAM',
) {
  const active = await ctx.tx.contactPoint.findMany({
    where: { leadId, type, status: 'ACTIVE' },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, isPrimary: true },
  });
  if (active.length > 0 && !active[0]!.isPrimary) {
    await makePrimary(ctx, leadId, { id: active[0]!.id, type });
  }
}

export const addContactPoint = defineUseCase({
  name: 'leads.addContactPoint',
  access: 'lead.update',
  input: addContactPointInput,
  async run(ctx, { leadId, ...input }) {
    const lead = await requireEditableLead(ctx, leadId, {
      id: true,
      originSourceId: true,
      municipality: { select: { ddd: true } },
    });
    const normalized = normalizeContactValue(
      input.type,
      input.value,
      lead.municipality?.ddd ? String(lead.municipality.ddd) : null,
    );
    if (!normalized.ok) {
      throw new ValidationError([{ path: 'value', message: normalized.message }]);
    }
    if (input.personId) await requirePersonOfLead(ctx, leadId, input.personId);
    const value = normalized.value;

    const existing = await ctx.tx.contactPoint.findUnique({
      where: {
        leadId_type_valueNormalized: {
          leadId,
          type: value.type,
          valueNormalized: value.valueNormalized,
        },
      },
    });
    if (existing && existing.status !== 'REMOVED') {
      throw new ConflictError('Este contato já está cadastrado no lead.');
    }

    const data = {
      personId: input.personId ?? null,
      valueRaw: value.valueRaw,
      label: input.label ?? null,
      phoneKind: value.phoneKind,
      whatsappStatus:
        value.type === 'PHONE' && input.isWhatsapp ? ('PROBABLE' as const) : ('UNKNOWN' as const),
      isPrimary: false,
      status: 'ACTIVE' as const,
      normalizationFlags: value.flags,
      sourceId: lead.originSourceId,
      collectedAt: ctx.now,
    };
    // Um contato removido antes volta a ser usado (o valor é único no lead).
    const cp = existing
      ? await ctx.tx.contactPoint.update({ where: { id: existing.id }, data })
      : await ctx.tx.contactPoint.create({
          data: {
            ...data,
            leadId,
            type: value.type,
            valueNormalized: value.valueNormalized,
            valueHash: ctx.deps.identifiers.hash(value.type, value.valueNormalized),
            createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
          },
        });
    if (input.isPrimary) await makePrimary(ctx, leadId, cp);
    else await ensurePrimary(ctx, leadId, cp.type);

    await refreshLeadContactState(ctx.tx, leadId);
    await touchLead(ctx, leadId);
    const masked = maskContactValue(cp.type, cp.valueNormalized);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.contactPointAdded, {
      payload: { type: cp.type, value: masked },
      subject: { type: 'contact_point', id: cp.id },
    });
    await auditLead(ctx, leadId, 'lead.contact_point.add', {
      subjectId: cp.id,
      changes: { [cp.type.toLowerCase()]: [null, masked] },
    });

    // Aviso (não bloqueia): o mesmo contato em outros leads; o par vai para a fila de revisão.
    const duplicates = await findDuplicateLeads(ctx, { contacts: [value], excludeLeadId: leadId });
    await queueDuplicateCheck(ctx, leadId);
    return { contactPointId: cp.id, duplicates };
  },
});

export const updateContactPoint = defineUseCase({
  name: 'leads.updateContactPoint',
  access: 'lead.update',
  input: updateContactPointInput,
  async run(ctx, { leadId, contactPointId, ...input }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const cp = await requireContactPoint(ctx, leadId, contactPointId);
    if (input.whatsappStatus && cp.type !== 'PHONE') {
      throw new ValidationError([
        { path: 'whatsappStatus', message: 'Só telefones têm WhatsApp.' },
      ]);
    }
    if (input.personId) await requirePersonOfLead(ctx, leadId, input.personId);

    const data = {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.whatsappStatus !== undefined ? { whatsappStatus: input.whatsappStatus } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.personId !== undefined ? { personId: input.personId } : {}),
    };
    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
      if (data[key] !== cp[key]) changes[key] = [cp[key], data[key]];
    }
    const primaryChange = input.isPrimary !== undefined && input.isPrimary !== cp.isPrimary;
    if (primaryChange) changes.isPrimary = [cp.isPrimary, input.isPrimary];
    if (Object.keys(changes).length === 0) return { contactPointId };

    const updated = await ctx.tx.contactPoint.update({ where: { id: contactPointId }, data });
    if (input.isPrimary && updated.status === 'ACTIVE') await makePrimary(ctx, leadId, updated);
    if (input.isPrimary === false || updated.status !== 'ACTIVE') {
      await ctx.tx.contactPoint.update({
        where: { id: contactPointId },
        data: { isPrimary: false },
      });
    }
    await ensurePrimary(ctx, leadId, cp.type);
    await refreshLeadContactState(ctx.tx, leadId);
    await touchLead(ctx, leadId);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.contactPointUpdated, {
      payload: {
        type: cp.type,
        value: maskContactValue(cp.type, cp.valueNormalized),
        fields: Object.keys(changes),
      },
      subject: { type: 'contact_point', id: contactPointId },
    });
    await auditLead(ctx, leadId, 'lead.contact_point.update', {
      subjectId: contactPointId,
      changes,
    });
    if (changes.status) await queueDuplicateCheck(ctx, leadId);
    return { contactPointId };
  },
});

/** Remove o contato do lead (status REMOVED; o registro fica para a auditoria). */
export const removeContactPoint = defineUseCase({
  name: 'leads.removeContactPoint',
  access: 'lead.update',
  input: contactPointRefInput,
  async run(ctx, { leadId, contactPointId }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const cp = await requireContactPoint(ctx, leadId, contactPointId);
    await ctx.tx.contactPoint.update({
      where: { id: contactPointId },
      data: { status: 'REMOVED', isPrimary: false },
    });
    await ensurePrimary(ctx, leadId, cp.type);
    await refreshLeadContactState(ctx.tx, leadId);
    await touchLead(ctx, leadId);
    const masked = maskContactValue(cp.type, cp.valueNormalized);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.contactPointRemoved, {
      payload: { type: cp.type, value: masked },
      subject: { type: 'contact_point', id: contactPointId },
    });
    await auditLead(ctx, leadId, 'lead.contact_point.remove', {
      subjectId: contactPointId,
      changes: { [cp.type.toLowerCase()]: [masked, null] },
    });
    return { ok: true };
  },
});
