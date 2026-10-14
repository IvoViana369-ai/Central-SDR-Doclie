import { NotFoundError } from '../../../shared/errors';
import { diffFields } from '../../../shared/diff';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { addPersonInput, personRefInput, updatePersonInput } from '../contracts/schemas';
import { LEAD_EVENTS } from '../domain/events';
import { formatName } from '../../normalization';
import { firstNameOf } from '../domain/lead';
import { auditLead, recordLeadEvent, touchLead } from '../infra/events';
import { requireEditableLead } from '../infra/scope';

/** Nome reduzido para a auditoria: "Maria Clara Souza" → "Maria S." (minimização). */
const shortName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)![0]}.` : (parts[0] ?? '');
};

async function requirePerson(ctx: UseCaseContext, leadId: string, personId: string) {
  const person = await ctx.tx.leadPerson.findFirst({
    where: { id: personId, leadId, status: 'ACTIVE' },
  });
  if (!person) throw new NotFoundError('Pessoa não encontrada.');
  return person;
}

/** Garante uma única pessoa principal por lead. */
async function clearPrimary(ctx: UseCaseContext, leadId: string, exceptId: string) {
  await ctx.tx.leadPerson.updateMany({
    where: { leadId, isPrimary: true, id: { not: exceptId } },
    data: { isPrimary: false },
  });
}

export const addPerson = defineUseCase({
  name: 'leads.addPerson',
  access: 'lead.update',
  input: addPersonInput,
  async run(ctx, { leadId, ...input }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const hasPrimary = await ctx.tx.leadPerson.count({
      where: { leadId, status: 'ACTIVE', isPrimary: true },
    });
    const person = await ctx.tx.leadPerson.create({
      data: {
        leadId,
        fullName: formatName(input.fullName),
        firstName: firstNameOf(formatName(input.fullName)),
        roleTitle: input.roleTitle ?? null,
        isPrimary: input.isPrimary || hasPrimary === 0,
        isDecisionMaker: input.isDecisionMaker,
        notes: input.notes ?? null,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
    });
    if (person.isPrimary) await clearPrimary(ctx, leadId, person.id);
    await touchLead(ctx, leadId);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.personAdded, {
      payload: { roleTitle: person.roleTitle },
      subject: { type: 'person', id: person.id },
    });
    await auditLead(ctx, leadId, 'lead.person.add', {
      subjectId: person.id,
      changes: { person: [null, shortName(person.fullName)] },
    });
    return person;
  },
});

export const updatePerson = defineUseCase({
  name: 'leads.updatePerson',
  access: 'lead.update',
  input: updatePersonInput,
  async run(ctx, { leadId, personId, ...input }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const person = await requirePerson(ctx, leadId, personId);
    const data = {
      ...(input.fullName !== undefined
        ? {
            fullName: formatName(input.fullName),
            firstName: firstNameOf(formatName(input.fullName)),
          }
        : {}),
      ...(input.roleTitle !== undefined ? { roleTitle: input.roleTitle } : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
      ...(input.isDecisionMaker !== undefined ? { isDecisionMaker: input.isDecisionMaker } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    const changes = diffFields(person, data, ['roleTitle', 'isPrimary', 'isDecisionMaker']);
    if (data.fullName !== undefined && data.fullName !== person.fullName) {
      changes.person = [shortName(person.fullName), shortName(data.fullName)];
    }
    if (data.notes !== undefined && data.notes !== person.notes) changes.notes = ['…', '…'];
    if (Object.keys(changes).length === 0) return person;

    const updated = await ctx.tx.leadPerson.update({ where: { id: personId }, data });
    if (updated.isPrimary) await clearPrimary(ctx, leadId, personId);
    await touchLead(ctx, leadId);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.personUpdated, {
      payload: { fields: Object.keys(changes) },
      subject: { type: 'person', id: personId },
    });
    await auditLead(ctx, leadId, 'lead.person.update', { subjectId: personId, changes });
    return updated;
  },
});

/** Remove a pessoa do lead (status "saiu"); os contatos dela continuam no lead. */
export const removePerson = defineUseCase({
  name: 'leads.removePerson',
  access: 'lead.update',
  input: personRefInput,
  async run(ctx, { leadId, personId }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const person = await requirePerson(ctx, leadId, personId);
    await ctx.tx.leadPerson.update({
      where: { id: personId },
      data: { status: 'LEFT', isPrimary: false },
    });
    await ctx.tx.contactPoint.updateMany({ where: { personId }, data: { personId: null } });
    await touchLead(ctx, leadId);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.personRemoved, {
      subject: { type: 'person', id: personId },
    });
    await auditLead(ctx, leadId, 'lead.person.remove', {
      subjectId: personId,
      changes: { person: [shortName(person.fullName), null] },
    });
    return { ok: true };
  },
});
