import { z } from 'zod';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { defineUseCase, toJson } from '../../../shared/use-case';
import {
  createApproachInput,
  updateAiRulesInput,
  updateApproachInput,
  upsertKnowledgeInput,
} from '../contracts/schemas';
import { AI_RULES_KEY, type AiRules } from '../domain/rules';
import { loadAiRules } from '../infra/sources';

const actorId = (actor: { kind: string; id?: string }) =>
  actor.kind === 'user' && actor.id ? actor.id : null;

/** Base de conhecimento (a única fonte de fatos sobre a Docline que a IA pode citar). */
export const listKnowledgeItems = defineUseCase({
  name: 'ai.knowledge.list',
  access: 'lead.read',
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async run(ctx, input) {
    return ctx.tx.aiKnowledgeItem.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { key: 'asc' }],
      select: {
        id: true,
        key: true,
        title: true,
        content: true,
        active: true,
        version: true,
        approvedAt: true,
        approvedBy: { select: { id: true, name: true } },
        updatedAt: true,
      },
    });
  },
});

/**
 * Cria ou altera um fato (ADMIN). Quem salva aprova o conteúdo; mudar o texto
 * sobe a versão (cada geração grava as versões usadas).
 */
export const upsertKnowledgeItem = defineUseCase({
  name: 'ai.knowledge.upsert',
  access: 'settings.manage',
  input: upsertKnowledgeInput,
  async run(ctx, input) {
    const current = await ctx.tx.aiKnowledgeItem.findUnique({ where: { key: input.key } });
    const approval = { approvedById: actorId(ctx.actor), approvedAt: ctx.now };
    const item = current
      ? await ctx.tx.aiKnowledgeItem.update({
          where: { id: current.id },
          data: {
            title: input.title,
            content: input.content,
            active: input.active,
            ...(current.content !== input.content
              ? { version: current.version + 1, ...approval }
              : {}),
          },
        })
      : await ctx.tx.aiKnowledgeItem.create({ data: { ...input, ...approval } });
    await ctx.audit({
      action: 'ai.knowledge.upsert',
      entityType: 'ai_knowledge_item',
      entityId: item.id,
      changes: current
        ? Object.fromEntries(
            (['title', 'content', 'active'] as const)
              .filter((k) => current[k] !== input[k])
              .map((k) => [k, [current[k], input[k]]]),
          )
        : null,
      metadata: { key: item.key, version: item.version },
    });
    return item;
  },
});

export const listApproaches = defineUseCase({
  name: 'ai.approaches.list',
  access: 'lead.read',
  input: z.object({ includeInactive: z.boolean().default(false) }),
  async run(ctx, input) {
    return ctx.tx.approach.findMany({
      where: input.includeInactive ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        hypothesis: true,
        guidance: true,
        active: true,
        _count: { select: { messages: true, generations: true } },
      },
    });
  },
});

export const createApproach = defineUseCase({
  name: 'ai.approaches.create',
  access: 'settings.manage',
  input: createApproachInput,
  async run(ctx, input) {
    if (await ctx.tx.approach.findUnique({ where: { key: input.key } })) {
      throw new ConflictError('Já existe uma abordagem com essa chave.');
    }
    const approach = await ctx.tx.approach.create({
      data: { ...input, createdById: actorId(ctx.actor) },
    });
    await ctx.audit({
      action: 'approach.create',
      entityType: 'approach',
      entityId: approach.id,
      metadata: { key: approach.key, name: approach.name },
    });
    return approach;
  },
});

export const updateApproach = defineUseCase({
  name: 'ai.approaches.update',
  access: 'settings.manage',
  input: updateApproachInput,
  async run(ctx, input) {
    const { approachId, ...data } = input;
    const current = await ctx.tx.approach.findUnique({ where: { id: approachId } });
    if (!current) throw new NotFoundError('Abordagem não encontrada.');
    const approach = await ctx.tx.approach.update({ where: { id: approachId }, data });
    await ctx.audit({
      action: 'approach.update',
      entityType: 'approach',
      entityId: approach.id,
      changes: Object.fromEntries(
        (Object.keys(data) as (keyof typeof data)[])
          .filter((k) => current[k] !== data[k])
          .map((k) => [k, [current[k], data[k]]]),
      ),
    });
    return approach;
  },
});

export const getAiRules = defineUseCase({
  name: 'ai.rules',
  access: 'lead.read',
  input: z.object({}),
  async run(ctx) {
    return loadAiRules(ctx.tx);
  },
});

/** Regras dos guardrails (ADMIN), com o antes e depois na auditoria. */
export const updateAiRules = defineUseCase({
  name: 'ai.rules.update',
  access: 'settings.manage',
  input: updateAiRulesInput,
  async run(ctx, input) {
    const before = await loadAiRules(ctx.tx);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of Object.keys(input) as (keyof AiRules)[]) {
      if (JSON.stringify(before[key]) !== JSON.stringify(input[key])) {
        changes[key] = [before[key], input[key]];
      }
    }
    const data = { value: toJson(input), updatedById: actorId(ctx.actor) };
    await ctx.tx.appSetting.upsert({
      where: { key: AI_RULES_KEY },
      create: { key: AI_RULES_KEY, ...data },
      update: data,
    });
    await ctx.audit({
      action: 'ai.rules',
      entityType: 'app_setting',
      entityId: AI_RULES_KEY,
      changes: Object.keys(changes).length > 0 ? changes : null,
    });
    return input;
  },
});
