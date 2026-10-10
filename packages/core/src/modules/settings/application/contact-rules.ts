import { z } from 'zod';
import { defineUseCase, toJson } from '../../../shared/use-case';
import { updateContactRulesInput } from '../contracts/schemas';
import { CONTACT_RULES_KEY, type ContactRules } from '../domain/contact-rules';
import { loadContactRules } from '../infra/contact-rules';

/** Regras de contato vigentes (a fila e a ficha mostram janela e limites). */
export const getContactRules = defineUseCase({
  name: 'settings.contactRules',
  access: 'lead.read',
  input: z.object({}),
  async run(ctx) {
    return loadContactRules(ctx.tx);
  },
});

/** Altera as regras de contato (ADMIN), com o antes e depois na auditoria. */
export const updateContactRules = defineUseCase({
  name: 'settings.updateContactRules',
  access: 'settings.manage',
  input: updateContactRulesInput,
  async run(ctx, input) {
    const before = await loadContactRules(ctx.tx);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of Object.keys(input) as (keyof ContactRules)[]) {
      if (JSON.stringify(before[key]) !== JSON.stringify(input[key])) {
        changes[key] = [before[key], input[key]];
      }
    }
    await ctx.tx.appSetting.upsert({
      where: { key: CONTACT_RULES_KEY },
      create: {
        key: CONTACT_RULES_KEY,
        value: toJson(input),
        updatedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
      update: {
        value: toJson(input),
        updatedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
    });
    await ctx.audit({
      action: 'settings.contact_rules',
      entityType: 'app_setting',
      entityId: CONTACT_RULES_KEY,
      changes: Object.keys(changes).length > 0 ? changes : null,
    });
    return input;
  },
});
