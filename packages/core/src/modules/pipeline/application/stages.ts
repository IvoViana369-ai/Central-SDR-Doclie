import { BusinessRuleError, NotFoundError, ValidationError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { toSearchKey } from '../../normalization';
import { listLossReasonsInput, pipelineIdInput, updateStagesInput } from '../contracts/schemas';

/** Pipeline pedido ou o padrão. */
export async function requirePipeline(ctx: UseCaseContext, pipelineId?: string) {
  const pipeline = await ctx.tx.pipeline.findFirst({
    where: pipelineId ? { id: pipelineId } : { isDefault: true },
    select: { id: true, key: true, name: true },
  });
  if (!pipeline) throw new NotFoundError('Pipeline não encontrado.');
  return pipeline;
}

export const stageSelect = {
  id: true,
  key: true,
  name: true,
  position: true,
  category: true,
  ownerRole: true,
  color: true,
  requiresLossReason: true,
  slaHours: true,
  isSystem: true,
  active: true,
  description: true,
} as const;

/** Pipeline com as etapas (todas, inclusive desativadas) na ordem do quadro. */
export const getPipeline = defineUseCase({
  name: 'pipeline.get',
  access: 'lead.read',
  input: pipelineIdInput,
  async run(ctx, input) {
    const pipeline = await requirePipeline(ctx, input.pipelineId);
    const stages = await ctx.tx.pipelineStage.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { position: 'asc' },
      select: stageSelect,
    });
    const counts = await ctx.tx.lead.groupBy({
      by: ['stageId'],
      where: { pipelineId: pipeline.id, status: 'ACTIVE' },
      _count: { _all: true },
    });
    const byStage = new Map(counts.map((c) => [c.stageId, c._count._all]));
    return {
      ...pipeline,
      stages: stages.map((s) => ({ ...s, leadCount: byStage.get(s.id) ?? 0 })),
    };
  },
});

/** Chave estável para uma etapa nova, a partir do nome ("Em negociação" → EM_NEGOCIACAO). */
function stageKeyFrom(name: string, taken: Set<string>): string {
  const base =
    toSearchKey(name)
      .toUpperCase()
      .replace(/ /g, '_')
      .replace(/[^A-Z0-9_]/g, '')
      .slice(0, 40) || 'ETAPA';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

/**
 * Configura as etapas (ADMIN; docs/MVP.md M08): nome, cor, ordem, SLA e
 * ativação, e etapas novas. Etapas do seed não podem ser desativadas (as
 * automações dependem das chaves) e nenhuma etapa com leads é desativada.
 */
export const updatePipelineStages = defineUseCase({
  name: 'pipeline.updateStages',
  access: 'settings.manage',
  input: updateStagesInput,
  async run(ctx, input) {
    const pipeline = await requirePipeline(ctx, input.pipelineId);
    const current = await ctx.tx.pipelineStage.findMany({
      where: { pipelineId: pipeline.id },
      select: stageSelect,
    });
    const byId = new Map(current.map((s) => [s.id, s]));
    const issues: { path: string; message: string }[] = [];
    const seen = new Set<string>();
    const names = new Set<string>();

    input.stages.forEach((stage, i) => {
      const nameKey = toSearchKey(stage.name);
      if (names.has(nameKey)) {
        issues.push({ path: `stages.${i}.name`, message: 'Já existe uma etapa com este nome.' });
      }
      names.add(nameKey);
      if (!stage.id) {
        if (!stage.category) {
          issues.push({ path: `stages.${i}.category`, message: 'Informe o tipo da etapa nova.' });
        }
        return;
      }
      const existing = byId.get(stage.id);
      if (!existing) {
        issues.push({ path: `stages.${i}.id`, message: 'Etapa não encontrada neste pipeline.' });
        return;
      }
      seen.add(stage.id);
      if (!stage.active && existing.isSystem) {
        issues.push({
          path: `stages.${i}.active`,
          message: `"${existing.name}" é uma etapa do sistema e não pode ser desativada.`,
        });
      }
    });
    const missing = current.filter((s) => !seen.has(s.id));
    if (missing.length > 0) {
      issues.push({
        path: 'stages',
        message: `Etapas não podem ser excluídas, só desativadas: ${missing.map((s) => s.name).join(', ')}.`,
      });
    }
    if (issues.length > 0) throw new ValidationError(issues);

    const deactivating = input.stages.filter((s) => s.id && !s.active && byId.get(s.id)?.active);
    if (deactivating.length > 0) {
      const withLeads = await ctx.tx.lead.groupBy({
        by: ['stageId'],
        where: {
          stageId: { in: deactivating.map((s) => s.id!) },
          status: { in: ['ACTIVE', 'ARCHIVED'] },
        },
        _count: { _all: true },
      });
      if (withLeads.length > 0) {
        const name = byId.get(withLeads[0]!.stageId!)?.name;
        throw new BusinessRuleError(
          `Mova os leads de "${name}" antes de desativar a etapa (${withLeads[0]!._count._all} leads).`,
        );
      }
    }

    const keys = new Set(current.map((s) => s.key));
    const changes: Record<string, [unknown, unknown]> = {};
    let position = 0;
    for (const stage of input.stages) {
      const data = {
        name: stage.name,
        color: stage.color,
        slaHours: stage.slaHours ?? null,
        active: stage.active,
        description: stage.description,
        position,
      };
      if (stage.id) {
        const before = byId.get(stage.id)!;
        for (const field of ['name', 'color', 'slaHours', 'active', 'position'] as const) {
          if (before[field] !== data[field]) {
            changes[`${before.key}.${field}`] = [before[field], data[field]];
          }
        }
        await ctx.tx.pipelineStage.update({ where: { id: stage.id }, data });
      } else {
        const key = stageKeyFrom(stage.name, keys);
        keys.add(key);
        await ctx.tx.pipelineStage.create({
          data: {
            ...data,
            pipelineId: pipeline.id,
            key,
            category: stage.category!,
            requiresLossReason: stage.category === 'LOST',
            isSystem: false,
          },
        });
        changes[`${key}.created`] = [null, stage.name];
      }
      position += 1;
    }
    await ctx.audit({
      action: 'pipeline.stages_update',
      entityType: 'pipeline',
      entityId: pipeline.id,
      changes: Object.keys(changes).length > 0 ? changes : null,
    });
    return { pipelineId: pipeline.id, stages: input.stages.length };
  },
});

/** Motivos de perda ativos (opcionalmente só os que valem para uma etapa). */
export const listLossReasons = defineUseCase({
  name: 'pipeline.listLossReasons',
  access: 'lead.read',
  input: listLossReasonsInput,
  async run(ctx, input) {
    const reasons = await ctx.tx.lossReason.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, key: true, name: true, appliesToStageKeys: true },
    });
    return input.stageKey
      ? reasons.filter(
          (r) =>
            r.appliesToStageKeys.length === 0 || r.appliesToStageKeys.includes(input.stageKey!),
        )
      : reasons;
  },
});
