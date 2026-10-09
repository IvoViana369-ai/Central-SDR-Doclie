import { z } from 'zod';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../shared/errors';
import { defineUseCase, toJson, type UseCaseContext } from '../../../shared/use-case';
import { saveViewInput, updateViewInput, viewRefInput } from '../contracts/filters';
import { compileLeadSelection } from '../infra/filters';

const ENTITY = 'leads';

const viewSelect = {
  id: true,
  name: true,
  filter: true,
  columns: true,
  sort: true,
  shared: true,
  ownerId: true,
  updatedAt: true,
  owner: { select: { name: true } },
} as const;

function requireUser(ctx: UseCaseContext): string {
  if (ctx.actor.kind !== 'user') throw new BusinessRuleError('Disponível apenas para usuários.');
  return ctx.actor.id;
}

async function requireOwnView(ctx: UseCaseContext, viewId: string) {
  const view = await ctx.tx.savedView.findUnique({ where: { id: viewId } });
  if (!view || view.entity !== ENTITY) throw new NotFoundError('Visão não encontrada.');
  if (view.ownerId !== requireUser(ctx))
    throw new ForbiddenError('Só quem criou pode alterar a visão.');
  return view;
}

/** Visões do usuário e as compartilhadas pela equipe (MVP M03, SHOULD). */
export const listSavedViews = defineUseCase({
  name: 'leads.listViews',
  access: 'lead.read',
  input: z.object({}),
  async run(ctx) {
    const userId = requireUser(ctx);
    const views = await ctx.tx.savedView.findMany({
      where: { entity: ENTITY, OR: [{ ownerId: userId }, { shared: true }] },
      orderBy: [{ shared: 'asc' }, { name: 'asc' }],
      select: viewSelect,
    });
    return views.map(({ owner, ...view }) => ({
      ...view,
      ownerName: owner.name,
      mine: view.ownerId === userId,
    }));
  },
});

export const saveView = defineUseCase({
  name: 'leads.saveView',
  access: 'lead.read',
  input: saveViewInput,
  async run(ctx, input) {
    const ownerId = requireUser(ctx);
    // Valida o filtro agora: uma visão salva nunca quebra a lista depois.
    compileLeadSelection(ctx.actor, input);
    const exists = await ctx.tx.savedView.findUnique({
      where: { ownerId_entity_name: { ownerId, entity: ENTITY, name: input.name } },
    });
    if (exists) throw new ConflictError('Você já tem uma visão com esse nome.');
    const view = await ctx.tx.savedView.create({
      data: {
        ownerId,
        entity: ENTITY,
        name: input.name,
        filter: toJson({ filter: input.filter ?? null, q: input.q ?? null }),
        sort: toJson(input.sort),
        ...(input.columns ? { columns: toJson(input.columns) } : {}),
        shared: input.shared,
      },
      select: viewSelect,
    });
    await ctx.audit({
      action: 'view.create',
      entityType: 'saved_view',
      entityId: view.id,
      changes: { name: [null, view.name], shared: [null, view.shared] },
    });
    return view;
  },
});

export const updateView = defineUseCase({
  name: 'leads.updateView',
  access: 'lead.read',
  input: updateViewInput,
  async run(ctx, { viewId, ...input }) {
    const current = await requireOwnView(ctx, viewId);
    const stored = (current.filter ?? {}) as { filter?: unknown; q?: string | null };
    const filter = input.filter !== undefined ? input.filter : stored.filter;
    const q = input.q !== undefined ? input.q : (stored.q ?? undefined);
    compileLeadSelection(ctx.actor, { filter: filter as never, q: q ?? undefined });
    if (input.name && input.name !== current.name) {
      const clash = await ctx.tx.savedView.findUnique({
        where: {
          ownerId_entity_name: { ownerId: current.ownerId, entity: ENTITY, name: input.name },
        },
      });
      if (clash) throw new ConflictError('Você já tem uma visão com esse nome.');
    }
    const view = await ctx.tx.savedView.update({
      where: { id: viewId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.filter !== undefined || input.q !== undefined
          ? { filter: toJson({ filter: filter ?? null, q: q ?? null }) }
          : {}),
        ...(input.sort !== undefined ? { sort: toJson(input.sort) } : {}),
        ...(input.columns !== undefined ? { columns: toJson(input.columns) } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
      },
      select: viewSelect,
    });
    await ctx.audit({ action: 'view.update', entityType: 'saved_view', entityId: viewId });
    return view;
  },
});

/** Visões são preferências (não dado de negócio): a exclusão é física, e auditada. */
export const deleteView = defineUseCase({
  name: 'leads.deleteView',
  access: 'lead.read',
  input: viewRefInput,
  async run(ctx, { viewId }) {
    const view = await requireOwnView(ctx, viewId);
    await ctx.tx.savedView.delete({ where: { id: viewId } });
    await ctx.audit({
      action: 'view.delete',
      entityType: 'saved_view',
      entityId: viewId,
      changes: { name: [view.name, null] },
    });
    return { ok: true };
  },
});
