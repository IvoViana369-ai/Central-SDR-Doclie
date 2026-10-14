import type { SuppressionScope, SuppressionType } from '@docline/db';
import { ValidationError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import {
  findActiveSuppressions,
  identifierKey,
  leadsByIdentifier,
  suppressIdentifiers,
  type ActiveSuppression,
  type SuppressionIdentifier,
  type SuppressionToCreate,
} from '../../compliance';
import { LEAD_EVENTS, recordLeadEvent } from '../../leads';
import { maskIdentifier, normalizeIdentifier, type IdentifierKind } from '../../normalization';
import { checkSuppressionsInput, registerExternalOptOutInput } from '../contracts/schemas';

interface NormalizedIdentifier {
  index: number;
  type: IdentifierKind;
  valueHash: string;
  valueMasked: string;
}

/** Normaliza e calcula o HMAC; os inválidos voltam com a mensagem. */
function normalizeAll(ctx: UseCaseContext, identifiers: { type: IdentifierKind; value: string }[]) {
  const valid: NormalizedIdentifier[] = [];
  const invalid: { index: number; type: IdentifierKind; message: string }[] = [];
  identifiers.forEach((identifier, index) => {
    const normalized = normalizeIdentifier(identifier.type, identifier.value);
    if (!normalized.ok) {
      invalid.push({ index, type: identifier.type, message: normalized.message });
      return;
    }
    valid.push({
      index,
      type: identifier.type,
      valueHash: ctx.deps.identifiers.hash(identifier.type, normalized.value),
      valueMasked: maskIdentifier(identifier.type, normalized.value),
    });
  });
  return { valid, invalid };
}

/** A supressão vale para o canal pedido? (ALL_CHANNELS = qualquer canal.) */
function blocks(suppression: ActiveSuppression, channel: SuppressionScope): boolean {
  return (
    channel === 'ALL_CHANNELS' ||
    suppression.scope === 'ALL_CHANNELS' ||
    suppression.scope === channel
  );
}

/**
 * Consulta da Lista Não Contatar por outros sistemas Docline (F12-04): para
 * cada identificador, diz se está bloqueado para o canal e por quê (o próprio
 * valor ou o escritório inteiro), sem revelar a lista, o motivo nem as notas.
 */
export const checkSuppressions = defineUseCase({
  name: 'integrations.checkSuppressions',
  access: 'suppression.check',
  input: checkSuppressionsInput,
  async run(ctx, input) {
    const { valid, invalid } = normalizeAll(ctx, input.identifiers);
    const direct = await findActiveSuppressions(ctx.tx, valid);

    // Telefone, e-mail ou @ de um escritório com opt-out do escritório inteiro
    // (lead ou CNPJ na lista) também está bloqueado.
    const byIdentifier = await leadsByIdentifier(
      ctx.tx,
      valid.filter((v) => v.type !== 'CNPJ'),
    );
    const leadIds = [...new Set([...byIdentifier.values()].flat())];
    const leads = await ctx.tx.lead.findMany({
      where: { id: { in: leadIds } },
      select: { id: true, cnpjHash: true },
    });
    const organizationIds: SuppressionIdentifier[] = leads.flatMap((lead) => [
      { type: 'LEAD' as SuppressionType, valueHash: lead.id },
      ...(lead.cnpjHash ? [{ type: 'CNPJ' as SuppressionType, valueHash: lead.cnpjHash }] : []),
    ]);
    const organization = await findActiveSuppressions(ctx.tx, organizationIds);
    const organizationBlocks = (leadId: string) => {
      const lead = leads.find((l) => l.id === leadId);
      const keys = [
        identifierKey({ type: 'LEAD', valueHash: leadId }),
        ...(lead?.cnpjHash ? [identifierKey({ type: 'CNPJ', valueHash: lead.cnpjHash })] : []),
      ];
      return keys
        .flatMap((key) => organization.get(key) ?? [])
        .filter((s) => blocks(s, input.channel));
    };

    const results = [
      ...valid.map((identifier) => {
        const own = (direct.get(identifierKey(identifier)) ?? []).filter((s) =>
          blocks(s, input.channel),
        );
        const viaOrganization = (byIdentifier.get(identifierKey(identifier)) ?? []).some(
          (leadId) => organizationBlocks(leadId).length > 0,
        );
        return {
          index: identifier.index,
          type: identifier.type,
          valid: true as const,
          valueMasked: identifier.valueMasked,
          suppressed: own.length > 0 || viaOrganization,
          /** IDENTIFIER: o próprio valor; ORGANIZATION: o escritório inteiro. */
          via: own.length > 0 ? 'IDENTIFIER' : viaOrganization ? 'ORGANIZATION' : null,
          scopes: [...new Set(own.map((s) => s.scope))],
        };
      }),
      ...invalid.map((item) => ({ ...item, valid: false as const, suppressed: false })),
    ].sort((a, b) => a.index - b.index);
    return { channel: input.channel, results };
  },
});

/**
 * Opt-out recebido em outro sistema Docline (F12-04): entra na Lista Não
 * Contatar com origem INTEGRATION, vale na hora para todos os leads com o
 * mesmo identificador e derruba o opt-in do WhatsApp dos números atingidos.
 * Volta como evento `optout.registered` para os demais sistemas.
 */
export const registerExternalOptOut = defineUseCase({
  name: 'integrations.registerExternalOptOut',
  access: 'optout.register',
  input: registerExternalOptOutInput,
  async run(ctx, input) {
    const { valid, invalid } = normalizeAll(ctx, input.identifiers);
    if (invalid.length > 0) {
      throw new ValidationError(
        invalid.map((item) => ({ path: `identifiers.${item.index}.value`, message: item.message })),
      );
    }
    const origin = ctx.actor.kind === 'apiKey' ? ctx.actor.name : null;
    const notes = [origin ? `Recebido de ${origin}` : null, input.notes].filter(Boolean).join(': ');
    const entries: SuppressionToCreate[] = valid.map((identifier) => ({
      type: identifier.type,
      valueHash: identifier.valueHash,
      valueMasked: identifier.valueMasked,
      scope: input.scope,
      reason: input.reason,
      source: ctx.actor.kind === 'apiKey' ? 'INTEGRATION' : undefined,
      notes: notes || null,
    }));
    const result = await suppressIdentifiers(ctx, entries);

    if (input.scope === 'ALL_CHANNELS' || input.scope === 'WHATSAPP') {
      const phoneHashes = entries.filter((e) => e.type === 'PHONE').map((e) => e.valueHash);
      if (phoneHashes.length > 0) {
        await ctx.tx.contactPermission.updateMany({
          where: {
            channel: 'WHATSAPP',
            optInStatus: 'GRANTED',
            contactPoint: { type: 'PHONE', valueHash: { in: phoneHashes } },
          },
          data: { optInStatus: 'REVOKED', recordedAt: ctx.now, recordedById: null },
        });
      }
    }
    for (const leadId of result.leadIds) {
      await recordLeadEvent(ctx, leadId, LEAD_EVENTS.optOutRegistered, {
        payload: { scope: input.scope, reason: input.reason, ...(origin ? { via: origin } : {}) },
      });
    }
    return {
      created: result.created.length,
      alreadySuppressed: result.alreadySuppressed,
      affectedLeads: result.leadIds.length,
    };
  },
});
