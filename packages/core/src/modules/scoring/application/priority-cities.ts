import { z } from 'zod';
import { JOBS } from '../../../jobs/catalog';
import { NotFoundError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { priorityCityInput, removePriorityCityInput } from '../contracts/schemas';

/** Cidades prioritárias (F4-08), com a quantidade de leads ativos em cada uma. */
export const listPriorityCities = defineUseCase({
  name: 'scoring.listPriorityCities',
  access: 'lead.read',
  input: z.object({}),
  async run(ctx) {
    const cities = await ctx.tx.priorityCity.findMany({
      where: { active: true },
      orderBy: { municipality: { name: 'asc' } },
      select: {
        municipalityCode: true,
        notes: true,
        createdAt: true,
        municipality: { select: { name: true, uf: true } },
        createdBy: { select: { name: true } },
      },
    });
    const counts = cities.length
      ? await ctx.tx.lead.groupBy({
          by: ['municipalityCode'],
          where: {
            status: 'ACTIVE',
            municipalityCode: { in: cities.map((c) => c.municipalityCode) },
          },
          _count: { _all: true },
        })
      : [];
    const byCode = new Map(counts.map((c) => [c.municipalityCode, c._count._all]));
    return cities.map((c) => ({
      municipalityCode: c.municipalityCode,
      name: c.municipality.name,
      uf: c.municipality.uf,
      notes: c.notes,
      createdAt: c.createdAt,
      createdByName: c.createdBy?.name ?? null,
      activeLeads: byCode.get(c.municipalityCode) ?? 0,
    }));
  },
});

/** O critério "Em cidade prioritária" mudou para os leads da cidade: recalcula no worker. */
async function recomputeCity(ctx: UseCaseContext, municipalityCode: number, trigger: string) {
  await ctx.deps.jobs.enqueue(
    JOBS.scoreRecomputeAll.name,
    { trigger, municipalityCode },
    { tx: ctx.tx },
  );
}

export const addPriorityCity = defineUseCase({
  name: 'scoring.addPriorityCity',
  access: 'settings.manage',
  input: priorityCityInput,
  async run(ctx, input) {
    const municipality = await ctx.tx.municipality.findUnique({
      where: { ibgeCode: input.municipalityCode },
      select: { name: true, uf: true },
    });
    if (!municipality) throw new NotFoundError('Município não encontrado.');
    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    await ctx.tx.priorityCity.upsert({
      where: { municipalityCode: input.municipalityCode },
      create: {
        municipalityCode: input.municipalityCode,
        notes: input.notes,
        createdById: actorId,
      },
      update: { active: true, notes: input.notes, createdById: actorId },
    });
    await recomputeCity(ctx, input.municipalityCode, 'priority_city.added');
    await ctx.audit({
      action: 'priority_city.add',
      entityType: 'priority_city',
      entityId: String(input.municipalityCode),
      metadata: { city: `${municipality.name}/${municipality.uf}` },
    });
    return { municipalityCode: input.municipalityCode };
  },
});

/** Tira a cidade da lista (o registro fica inativo, para o histórico). */
export const removePriorityCity = defineUseCase({
  name: 'scoring.removePriorityCity',
  access: 'settings.manage',
  input: removePriorityCityInput,
  async run(ctx, input) {
    const city = await ctx.tx.priorityCity.findFirst({
      where: { municipalityCode: input.municipalityCode, active: true },
      select: { municipality: { select: { name: true, uf: true } } },
    });
    if (!city) throw new NotFoundError('Cidade não está na lista de prioridades.');
    await ctx.tx.priorityCity.update({
      where: { municipalityCode: input.municipalityCode },
      data: { active: false },
    });
    await recomputeCity(ctx, input.municipalityCode, 'priority_city.removed');
    await ctx.audit({
      action: 'priority_city.remove',
      entityType: 'priority_city',
      entityId: String(input.municipalityCode),
      metadata: { city: `${city.municipality.name}/${city.municipality.uf}` },
    });
    return { municipalityCode: input.municipalityCode };
  },
});
