import { ConflictError } from '../../../shared/errors';
import { diffFields } from '../../../shared/diff';
import { defineUseCase } from '../../../shared/use-case';
import { updateLeadInput } from '../contracts/schemas';
import { LEAD_EVENTS } from '../domain/events';
import { refreshLeadContactState } from '../../compliance';
import { recomputeLeadScores } from '../../scoring';
import { auditLead, queueDuplicateCheck, recordLeadEvent } from '../infra/events';
import { requireLeadInScope } from '../infra/scope';
import { blockingDuplicates, findDuplicateLeads, PossibleDuplicateError } from './duplicates';
import { loadLeadDetail } from './get-lead';
import { resolveLeadFields, type LeadFieldValues } from './normalize-input';

const AUDITED_FIELDS: (keyof LeadFieldValues)[] = [
  'companyName',
  'tradeName',
  'leadType',
  'segmentId',
  'category',
  'cnpj',
  'addressLine',
  'addressNumber',
  'addressComplement',
  'neighborhood',
  'cityRaw',
  'municipalityCode',
  'stateUf',
  'postalCode',
  'websiteUrl',
  'description',
];

/** Campos que a deduplicação compara: mudou um deles, o lead é verificado de novo. */
const IDENTITY_FIELDS = new Set([
  'companyName',
  'tradeName',
  'cnpj',
  'websiteUrl',
  'cityRaw',
  'municipalityCode',
  'stateUf',
]);

/** Campos que são critérios do score (cidade prioritária, UF, tipo). */
const SCORE_FIELDS = ['leadType', 'municipalityCode', 'cityRaw', 'stateUf'];
const fieldsChanged = (changes: object, fields: string[]) => fields.some((f) => f in changes);

export const updateLead = defineUseCase({
  name: 'leads.update',
  access: 'lead.update',
  input: updateLeadInput,
  async run(ctx, { leadId, version, ...input }) {
    const current = await requireLeadInScope(ctx, leadId, {
      id: true,
      version: true,
      status: true,
      companyName: true,
      tradeName: true,
      leadType: true,
      segmentId: true,
      category: true,
      cnpj: true,
      addressLine: true,
      addressNumber: true,
      addressComplement: true,
      neighborhood: true,
      cityRaw: true,
      municipalityCode: true,
      stateUf: true,
      postalCode: true,
      websiteUrl: true,
      description: true,
    });
    if (current.status === 'MERGED' || current.status === 'ANONYMIZED') {
      throw new ConflictError('Este lead não pode mais ser editado.');
    }
    if (current.version !== version) {
      throw new ConflictError('O lead foi alterado por outra pessoa. Recarregue e tente de novo.');
    }

    const { data } = await resolveLeadFields(ctx.tx, ctx.deps.identifiers, input, current);
    const changes = diffFields(current as LeadFieldValues, data, AUDITED_FIELDS);
    if (Object.keys(changes).length === 0) return loadLeadDetail(ctx, leadId);

    if ('cnpj' in changes && data.cnpj) {
      const blocking = blockingDuplicates(
        await findDuplicateLeads(ctx, { cnpj: data.cnpj, contacts: [], excludeLeadId: leadId }),
      );
      if (blocking.length > 0) {
        throw new PossibleDuplicateError(
          blocking,
          `Já existe um lead com este CNPJ (${blocking.map((d) => d.code).join(', ')}).`,
        );
      }
    }

    // Lock otimista: a versão é conferida de novo na própria gravação.
    const updated = await ctx.tx.lead.updateMany({
      where: { id: leadId, version },
      data: { ...data, version: { increment: 1 }, lastActivityAt: ctx.now },
    });
    if (updated.count === 0) {
      throw new ConflictError('O lead foi alterado por outra pessoa. Recarregue e tente de novo.');
    }

    if ('cnpj' in changes || 'websiteUrl' in changes) {
      // Também recalcula o score (site e CNPJ são critérios).
      await refreshLeadContactState(ctx.tx, leadId, ctx.now);
    } else if (fieldsChanged(changes, SCORE_FIELDS)) {
      await recomputeLeadScores(ctx.tx, [leadId], 'lead.update', ctx.now);
    }
    const fields = Object.keys(changes);
    if (fields.some((f) => IDENTITY_FIELDS.has(f))) await queueDuplicateCheck(ctx, leadId);
    await recordLeadEvent(ctx, leadId, LEAD_EVENTS.updated, { payload: { fields } });
    await auditLead(ctx, leadId, 'lead.update', { changes });
    return loadLeadDetail(ctx, leadId);
  },
});
