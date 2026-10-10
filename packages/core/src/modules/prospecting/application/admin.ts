import { z } from 'zod';
import { defineUseCase, toJson } from '../../../shared/use-case';
import {
  REGISTRY_SETTINGS_KEY,
  registrySettingsSchema,
  resolveRegistrySettings,
} from '../domain/settings';

/**
 * Painel da base aberta do CNPJ (ADMIN): fonte configurada, cargas recentes
 * (com progresso e totais), o que está guardado e a configuração.
 */
export const getRegistryOverview = defineUseCase({
  name: 'registry.overview',
  access: 'integration.manage',
  input: z.object({}),
  async run(ctx) {
    const row = await ctx.tx.appSetting.findUnique({ where: { key: REGISTRY_SETTINGS_KEY } });
    const ingestions = await ctx.tx.registryIngestion.findMany({
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true,
        provider: true,
        reference: true,
        status: true,
        progress: true,
        stats: true,
        error: true,
        startedAt: true,
        finishedAt: true,
        updatedAt: true,
        requestedById: true,
      },
    });
    const userIds = [
      ...new Set(ingestions.flatMap((i) => (i.requestedById ? [i.requestedById] : []))),
    ];
    const users = userIds.length
      ? await ctx.tx.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    const total = await ctx.tx.registryCompany.count();
    const individuals = await ctx.tx.registryCompany.count({
      where: { isIndividualEntrepreneur: true },
    });
    const byUf = await ctx.tx.registryCompany.groupBy({
      by: ['uf'],
      _count: { _all: true },
      orderBy: { uf: 'asc' },
    });
    const current = ingestions.find((i) => i.status === 'SUCCEEDED') ?? null;
    return {
      /** `receita_open_data`, `fake` (simulada) ou nulo (desligada). */
      provider: ctx.deps.companyRegistry?.name ?? null,
      settings: resolveRegistrySettings(row?.value),
      current: current ? { reference: current.reference, finishedAt: current.finishedAt } : null,
      total,
      individuals,
      byUf: byUf.map((g) => ({ uf: g.uf, count: g._count._all })),
      ingestions: ingestions.map(({ requestedById, ...i }) => ({
        ...i,
        requestedBy: requestedById ? (names.get(requestedById) ?? null) : null,
      })),
    };
  },
});

/** Configuração da carga (vale a partir da próxima). */
export const updateRegistrySettings = defineUseCase({
  name: 'registry.settings.update',
  access: 'integration.manage',
  input: registrySettingsSchema,
  async run(ctx, input) {
    const row = await ctx.tx.appSetting.findUnique({ where: { key: REGISTRY_SETTINGS_KEY } });
    const before = resolveRegistrySettings(row?.value);
    const data = {
      value: toJson(input),
      updatedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
    };
    await ctx.tx.appSetting.upsert({
      where: { key: REGISTRY_SETTINGS_KEY },
      create: { key: REGISTRY_SETTINGS_KEY, ...data },
      update: data,
    });
    await ctx.audit({
      action: 'registry.settings',
      entityType: 'app_setting',
      entityId: REGISTRY_SETTINGS_KEY,
      changes: Object.fromEntries(
        (Object.keys(input) as (keyof typeof input)[])
          .filter((k) => before[k] !== input[k])
          .map((k) => [k, [before[k], input[k]]]),
      ),
    });
    return input;
  },
});
