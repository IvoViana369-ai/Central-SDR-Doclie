import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { addNoteInput, noteRefInput, setNotePinnedInput } from '../contracts/schemas';
import { LEAD_EVENTS } from '../domain/events';
import { auditLead, recordLeadEvent, touchLead } from '../infra/events';
import { requireEditableLead } from '../infra/scope';

async function requireNote(ctx: UseCaseContext, leadId: string, noteId: string) {
  const note = await ctx.tx.leadNote.findFirst({ where: { id: noteId, leadId, removedAt: null } });
  if (!note) throw new NotFoundError('Observação não encontrada.');
  return note;
}

/**
 * Observação com autor e data (MVP M02). O texto não vai para a timeline nem
 * para a auditoria (pode conter dados pessoais); ambos registram só a referência.
 */
export const addNote = defineUseCase({
  name: 'leads.addNote',
  access: 'lead.update',
  input: addNoteInput,
  async run(ctx, { leadId, body, pinned }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const note = await ctx.tx.leadNote.create({
      data: {
        leadId,
        body,
        pinned,
        authorId: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        createdAt: ctx.now,
      },
      select: {
        id: true,
        body: true,
        pinned: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
      },
    });
    await touchLead(ctx, leadId);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.noteAdded, {
      payload: { length: body.length },
      subject: { type: 'note', id: note.id },
    });
    await auditLead(ctx, leadId, 'lead.note.add', { subjectId: note.id });
    return note;
  },
});

export const setNotePinned = defineUseCase({
  name: 'leads.setNotePinned',
  access: 'lead.update',
  input: setNotePinnedInput,
  async run(ctx, { leadId, noteId, pinned }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const note = await requireNote(ctx, leadId, noteId);
    if (note.pinned === pinned) return { ok: true };
    await ctx.tx.leadNote.update({ where: { id: noteId }, data: { pinned } });
    await auditLead(ctx, leadId, 'lead.note.pin', {
      subjectId: noteId,
      changes: { pinned: [note.pinned, pinned] },
    });
    return { ok: true };
  },
});

/** Remoção lógica: só o autor ou um administrador (ex.: dado sensível registrado por engano). */
export const removeNote = defineUseCase({
  name: 'leads.removeNote',
  access: 'lead.update',
  input: noteRefInput,
  async run(ctx, { leadId, noteId }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const note = await requireNote(ctx, leadId, noteId);
    const actor = ctx.actor;
    const allowed = actor.kind !== 'user' || actor.role === 'ADMIN' || note.authorId === actor.id;
    if (!allowed)
      throw new ForbiddenError('Só o autor ou um administrador pode remover a observação.');
    await ctx.tx.leadNote.update({
      where: { id: noteId },
      data: { removedAt: ctx.now, removedById: actor.kind === 'user' ? actor.id : null },
    });
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.noteRemoved, {
      subject: { type: 'note', id: noteId },
    });
    await auditLead(ctx, leadId, 'lead.note.remove', { subjectId: noteId });
    return { ok: true };
  },
});
