import type { ExternalEntityType } from '@docline/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { auditLead, formatLeadCode } from '../../leads';
import {
  findExternalReferencesInput,
  removeExternalReferenceInput,
  upsertExternalReferenceInput,
} from '../contracts/schemas';
import { systemLabel } from '../domain/references';

const referenceSelect = {
  id: true,
  entityType: true,
  entityId: true,
  system: true,
  externalId: true,
  url: true,
  syncedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Sistema do vínculo: a chave de API ligada a um sistema só grava nele; sem
 * sistema na chave (ou para pessoas), o sistema vem no pedido.
 */
function resolveSystem(ctx: UseCaseContext, requested: string | undefined): string {
  if (ctx.actor.kind === 'apiKey' && ctx.actor.system) {
    if (requested && requested !== ctx.actor.system) {
      throw new ForbiddenError(`Esta chave só grava referências do sistema ${ctx.actor.system}.`);
    }
    return ctx.actor.system;
  }
  if (!requested) {
    throw new ValidationError([
      { path: 'system', message: 'Informe o sistema (ex.: DOCLINE_CRM).' },
    ]);
  }
  return requested;
}

/** O registro existe? Devolve o lead dono (para a auditoria e o código). */
async function requireEntity(
  ctx: UseCaseContext,
  entityType: ExternalEntityType,
  entityId: string,
) {
  if (entityType === 'LEAD') {
    const lead = await ctx.tx.lead.findUnique({
      where: { id: entityId },
      select: { id: true, code: true },
    });
    if (!lead) throw new NotFoundError('Lead não encontrado.');
    return lead;
  }
  const opportunity = await ctx.tx.opportunity.findUnique({
    where: { id: entityId },
    select: { lead: { select: { id: true, code: true } } },
  });
  if (!opportunity) throw new NotFoundError('Oportunidade não encontrada.');
  return opportunity.lead;
}

function describe(reference: {
  entityType: ExternalEntityType;
  system: string;
  [key: string]: unknown;
}) {
  return { ...reference, systemLabel: systemLabel(reference.system) };
}

/**
 * Vincula (ou atualiza) o id do registro em outro sistema Docline (F12-03).
 * Um id externo nunca muda de dono sozinho: se já aponta para outro registro,
 * a resposta é conflito (desfaça o vínculo antigo antes).
 */
export const upsertExternalReference = defineUseCase({
  name: 'integrations.upsertExternalReference',
  access: 'reference.manage',
  input: upsertExternalReferenceInput,
  async run(ctx, input) {
    const system = resolveSystem(ctx, input.system);
    const lead = await requireEntity(ctx, input.entityType, input.entityId);
    const taken = await ctx.tx.externalReference.findUnique({
      where: {
        system_entityType_externalId: {
          system,
          entityType: input.entityType,
          externalId: input.externalId,
        },
      },
      select: { entityId: true },
    });
    if (taken && taken.entityId !== input.entityId) {
      const owner = await requireEntity(ctx, input.entityType, taken.entityId).catch(() => null);
      throw new ConflictError(
        `O id ${input.externalId} em ${systemLabel(system)} já está vinculado${
          owner ? ` ao lead ${formatLeadCode(owner.code)}` : ' a outro registro'
        }.`,
      );
    }
    const key = {
      entityType_entityId_system: {
        entityType: input.entityType,
        entityId: input.entityId,
        system,
      },
    };
    const before = await ctx.tx.externalReference.findUnique({
      where: key,
      select: referenceSelect,
    });
    const createdBy =
      ctx.actor.kind === 'user'
        ? { createdById: ctx.actor.id }
        : ctx.actor.kind === 'apiKey'
          ? { createdByKeyId: ctx.actor.id }
          : {};
    const reference = await ctx.tx.externalReference.upsert({
      where: key,
      create: {
        entityType: input.entityType,
        entityId: input.entityId,
        system,
        externalId: input.externalId,
        url: input.url ?? null,
        syncedAt: ctx.now,
        createdAt: ctx.now,
        ...createdBy,
      },
      update: {
        externalId: input.externalId,
        ...(input.url !== undefined ? { url: input.url } : {}),
        syncedAt: ctx.now,
      },
      select: referenceSelect,
    });
    const changed =
      !before || before.externalId !== reference.externalId || before.url !== reference.url;
    if (changed) {
      await auditLead(ctx, lead.id, before ? 'reference.update' : 'reference.link', {
        subjectId: input.entityType === 'OPPORTUNITY' ? input.entityId : undefined,
        changes: {
          [`reference.${system}`]: [before?.externalId ?? null, reference.externalId],
          ...(before?.url !== reference.url ? { url: [before?.url ?? null, reference.url] } : {}),
        },
        metadata: { entityType: input.entityType, system },
      });
    }
    return { ...describe(reference), created: !before };
  },
});

/** Desfaz o vínculo (pedido explícito; nada é desfeito sozinho). */
export const removeExternalReference = defineUseCase({
  name: 'integrations.removeExternalReference',
  access: 'reference.manage',
  input: removeExternalReferenceInput,
  async run(ctx, input) {
    const system = resolveSystem(ctx, input.system);
    const lead = await requireEntity(ctx, input.entityType, input.entityId);
    const where = {
      entityType_entityId_system: {
        entityType: input.entityType,
        entityId: input.entityId,
        system,
      },
    };
    const existing = await ctx.tx.externalReference.findUnique({ where, select: referenceSelect });
    if (!existing) throw new NotFoundError('Vínculo não encontrado.');
    await ctx.tx.externalReference.delete({ where });
    await auditLead(ctx, lead.id, 'reference.unlink', {
      subjectId: input.entityType === 'OPPORTUNITY' ? input.entityId : undefined,
      changes: { [`reference.${system}`]: [existing.externalId, null] },
      metadata: { entityType: input.entityType, system },
    });
    return { removed: true };
  },
});

/** Acha o registro pelo id externo, ou lista os vínculos de um registro. */
export const findExternalReferences = defineUseCase({
  name: 'integrations.findExternalReferences',
  access: 'reference.read',
  input: findExternalReferencesInput,
  async run(ctx, input) {
    const system =
      input.system ?? (ctx.actor.kind === 'apiKey' ? (ctx.actor.system ?? undefined) : undefined);
    const rows = await ctx.tx.externalReference.findMany({
      where: {
        entityType: input.entityType,
        ...(input.entityId ? { entityId: input.entityId } : {}),
        ...(input.externalId ? { externalId: input.externalId } : {}),
        ...(system ? { system } : {}),
      },
      select: referenceSelect,
      orderBy: [{ system: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    const opportunities =
      input.entityType === 'OPPORTUNITY'
        ? await ctx.tx.opportunity.findMany({
            where: { id: { in: rows.map((r) => r.entityId) } },
            select: { id: true, leadId: true },
          })
        : [];
    const leadOf = (row: (typeof rows)[number]) =>
      input.entityType === 'LEAD'
        ? row.entityId
        : opportunities.find((o) => o.id === row.entityId)?.leadId;
    const leads = await ctx.tx.lead.findMany({
      where: { id: { in: rows.map(leadOf).filter((id) => id !== undefined) } },
      select: { id: true, code: true },
    });
    return {
      data: rows.map((row) => {
        const lead = leads.find((l) => l.id === leadOf(row));
        return {
          ...describe(row),
          lead: lead ? { id: lead.id, code: formatLeadCode(lead.code) } : null,
        };
      }),
    };
  },
});
