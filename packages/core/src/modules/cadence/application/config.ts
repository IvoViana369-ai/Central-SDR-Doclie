import type { Prisma } from '@docline/db';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { toSearchKey } from '../../normalization';
import { cadenceConfigInput, cadenceIdInput, updateCadenceInput } from '../contracts/schemas';
import { validateCadenceSteps } from '../domain/schedule';
import { z } from 'zod';

const cadenceInclude = {
  steps: { orderBy: { position: 'asc' } },
  _count: { select: { enrollments: { where: { status: { in: ['ACTIVE', 'PAUSED'] } } } } },
} satisfies Prisma.CadenceInclude;

type CadenceRow = Prisma.CadenceGetPayload<{ include: typeof cadenceInclude }>;

function describeCadence(c: CadenceRow) {
  const { _count, ...rest } = c;
  return { ...rest, ongoingEnrollments: _count.enrollments };
}

/** Cadências (todas para o ADMIN; as ativas para quem inscreve leads). */
export const listCadences = defineUseCase({
  name: 'cadence.list',
  access: 'lead.read',
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async run(ctx, input) {
    const cadences = await ctx.tx.cadence.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: cadenceInclude,
    });
    return cadences.map(describeCadence);
  },
});

/** Confere passos e etapas-alvo (precisam existir no pipeline padrão). */
async function validateConfig(
  ctx: UseCaseContext,
  input: {
    steps: { dayOffset: number; targetStageKey: string | null }[];
    sendWindowStart: string;
    sendWindowEnd: string;
  },
) {
  const issues = validateCadenceSteps(input.steps).map((message) => ({ path: 'steps', message }));
  if (input.sendWindowStart >= input.sendWindowEnd) {
    issues.push({ path: 'sendWindowEnd', message: 'O fim da janela deve ser depois do início.' });
  }
  const keys = [
    ...new Set(input.steps.flatMap((s) => (s.targetStageKey ? [s.targetStageKey] : []))),
  ];
  if (keys.length > 0) {
    const found = await ctx.tx.pipelineStage.findMany({
      where: { key: { in: keys }, pipeline: { isDefault: true }, active: true },
      select: { key: true, category: true },
    });
    input.steps.forEach((s, i) => {
      if (!s.targetStageKey) return;
      const stage = found.find((f) => f.key === s.targetStageKey);
      if (!stage) {
        issues.push({
          path: `steps.${i}.targetStageKey`,
          message: 'Etapa não encontrada ou inativa.',
        });
      } else if (stage.category !== 'OPEN') {
        issues.push({
          path: `steps.${i}.targetStageKey`,
          message: 'Um passo só leva o lead para etapas em andamento.',
        });
      }
    });
  }
  if (issues.length > 0) throw new ValidationError(issues);
}

function stepsData(steps: z.output<typeof cadenceConfigInput>['steps']) {
  return steps.map((s, i) => ({
    position: i + 1,
    dayOffset: s.dayOffset,
    channel: s.channel,
    action: s.action,
    messageType: s.messageType,
    targetStageKey: s.targetStageKey,
    instructions: s.instructions,
  }));
}

/** Cadência nova (ADMIN). */
export const createCadence = defineUseCase({
  name: 'cadence.create',
  access: 'settings.manage',
  input: cadenceConfigInput,
  async run(ctx, input) {
    await validateConfig(ctx, input);
    const base =
      toSearchKey(input.name).toUpperCase().replace(/ /g, '_').slice(0, 40) || 'CADENCIA';
    let key = base;
    for (let n = 2; await ctx.tx.cadence.findUnique({ where: { key } }); n++) key = `${base}_${n}`;
    const { steps, ...rules } = input;
    const cadence = await ctx.tx.cadence.create({
      data: {
        ...rules,
        key,
        createdById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        steps: { createMany: { data: stepsData(steps) } },
      },
      include: cadenceInclude,
    });
    await ctx.audit({
      action: 'cadence.create',
      entityType: 'cadence',
      entityId: cadence.id,
      metadata: { name: cadence.name, steps: steps.length },
    });
    return describeCadence(cadence);
  },
});

/**
 * Altera regras e passos (ADMIN): sobe a versão. Inscrições em andamento
 * seguem pela posição do passo; se a cadência ficar menor, terminam no
 * prazo de "Sem resposta".
 */
export const updateCadence = defineUseCase({
  name: 'cadence.update',
  access: 'settings.manage',
  input: updateCadenceInput,
  async run(ctx, input) {
    const current = await ctx.tx.cadence.findUnique({
      where: { id: input.cadenceId },
      include: cadenceInclude,
    });
    if (!current) throw new NotFoundError('Cadência não encontrada.');
    if (current.isDefault && !input.active) {
      throw new BusinessRuleError(
        'A cadência padrão não pode ser desativada. Escolha outra como padrão antes.',
      );
    }
    await validateConfig(ctx, input);
    const { cadenceId, steps, ...rules } = input;
    await ctx.tx.cadenceStep.deleteMany({ where: { cadenceId } });
    const updated = await ctx.tx.cadence.update({
      where: { id: cadenceId },
      data: {
        ...rules,
        version: { increment: 1 },
        steps: { createMany: { data: stepsData(steps) } },
      },
      include: cadenceInclude,
    });
    await ctx.audit({
      action: 'cadence.update',
      entityType: 'cadence',
      entityId: cadenceId,
      changes: { version: [current.version, updated.version] },
      metadata: { name: updated.name, steps: steps.length, ongoing: current._count.enrollments },
    });
    return describeCadence(updated);
  },
});

/** Escolhe a cadência padrão (a usada quando ninguém escolhe outra). */
export const setDefaultCadence = defineUseCase({
  name: 'cadence.setDefault',
  access: 'settings.manage',
  input: cadenceIdInput,
  async run(ctx, input) {
    const cadence = await ctx.tx.cadence.findUnique({ where: { id: input.cadenceId } });
    if (!cadence) throw new NotFoundError('Cadência não encontrada.');
    if (!cadence.active) throw new BusinessRuleError('Ative a cadência antes de torná-la padrão.');
    await ctx.tx.cadence.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    await ctx.tx.cadence.update({ where: { id: cadence.id }, data: { isDefault: true } });
    await ctx.audit({
      action: 'cadence.set_default',
      entityType: 'cadence',
      entityId: cadence.id,
      metadata: { name: cadence.name },
    });
    return { cadenceId: cadence.id };
  },
});
