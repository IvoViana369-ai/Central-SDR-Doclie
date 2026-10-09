import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { diffFields } from '../../../shared/diff';
import { defineUseCase } from '../../../shared/use-case';
import { cleanText, toSearchKey } from '../../normalization';
import { createTagInput, leadTagInput, updateTagInput } from '../contracts/schemas';
import { LEAD_EVENTS } from '../domain/events';
import { auditLead, recordLeadEvent, touchLead } from '../infra/events';
import { requireEditableLead } from '../infra/scope';

const tagSelect = { id: true, name: true, color: true, category: true, active: true } as const;

export const listTags = defineUseCase({
  name: 'leads.listTags',
  access: 'lead.read',
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async run(ctx, input) {
    return ctx.tx.tag.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: { nameSearch: 'asc' },
      select: tagSelect,
    });
  },
});

export const createTag = defineUseCase({
  name: 'leads.createTag',
  access: 'tag.manage',
  input: createTagInput,
  async run(ctx, input) {
    const name = cleanText(input.name);
    const nameSearch = toSearchKey(name);
    const existing = await ctx.tx.tag.findUnique({ where: { nameSearch } });
    if (existing) throw new ConflictError(`Já existe a tag "${existing.name}".`);
    const tag = await ctx.tx.tag.create({
      data: {
        name,
        nameSearch,
        color: input.color,
        category: input.category ?? null,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
      select: tagSelect,
    });
    await ctx.audit({
      action: 'tag.create',
      entityType: 'tag',
      entityId: tag.id,
      changes: { name: [null, tag.name] },
    });
    return tag;
  },
});

export const updateTag = defineUseCase({
  name: 'leads.updateTag',
  access: 'tag.manage',
  input: updateTagInput,
  async run(ctx, { tagId, ...input }) {
    const tag = await ctx.tx.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw new NotFoundError('Tag não encontrada.');
    const data: {
      name?: string;
      nameSearch?: string;
      color?: string;
      category?: string | null;
      active?: boolean;
    } = {};
    if (input.name !== undefined) {
      data.name = cleanText(input.name);
      data.nameSearch = toSearchKey(data.name);
      const clash = await ctx.tx.tag.findFirst({
        where: { nameSearch: data.nameSearch, id: { not: tagId } },
      });
      if (clash) throw new ConflictError(`Já existe a tag "${clash.name}".`);
    }
    if (input.color !== undefined) data.color = input.color;
    if (input.category !== undefined) data.category = input.category;
    if (input.active !== undefined) data.active = input.active;
    const changes = diffFields(tag, data, ['name', 'color', 'category', 'active']);
    if (Object.keys(changes).length === 0) return { ...tag };
    const updated = await ctx.tx.tag.update({ where: { id: tagId }, data, select: tagSelect });
    await ctx.audit({ action: 'tag.update', entityType: 'tag', entityId: tagId, changes });
    return updated;
  },
});

export const addLeadTag = defineUseCase({
  name: 'leads.addTag',
  access: 'lead.update',
  input: leadTagInput,
  async run(ctx, { leadId, tagId }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const tag = await ctx.tx.tag.findFirst({ where: { id: tagId, active: true } });
    if (!tag) throw new NotFoundError('Tag não encontrada.');
    const created = await ctx.tx.leadTag.createMany({
      data: [{ leadId, tagId, addedById: ctx.actor.kind === 'user' ? ctx.actor.id : null }],
      skipDuplicates: true,
    });
    if (created.count === 0) return { ok: true };
    await touchLead(ctx, leadId);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.tagAdded, {
      payload: { tagId, name: tag.name },
      subject: { type: 'tag', id: tagId },
    });
    await auditLead(ctx, leadId, 'lead.tag.add', {
      subjectId: tagId,
      changes: { tag: [null, tag.name] },
    });
    return { ok: true };
  },
});

export const removeLeadTag = defineUseCase({
  name: 'leads.removeTag',
  access: 'lead.update',
  input: leadTagInput,
  async run(ctx, { leadId, tagId }) {
    await requireEditableLead(ctx, leadId, { id: true });
    const removed = await ctx.tx.leadTag.deleteMany({ where: { leadId, tagId } });
    if (removed.count === 0) return { ok: true };
    const tag = await ctx.tx.tag.findUnique({ where: { id: tagId }, select: { name: true } });
    await touchLead(ctx, leadId);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.tagRemoved, {
      payload: { tagId, name: tag?.name ?? null },
      subject: { type: 'tag', id: tagId },
    });
    await auditLead(ctx, leadId, 'lead.tag.remove', {
      subjectId: tagId,
      changes: { tag: [tag?.name ?? tagId, null] },
    });
    return { ok: true };
  },
});
