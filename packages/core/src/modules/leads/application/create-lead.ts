import { newId, type ContactStatus } from '@docline/db';
import { roleHasPermission } from '../../identity';
import { ForbiddenError, ValidationError, type ValidationIssue } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import { createLeadInput } from '../contracts/schemas';
import { LEAD_EVENTS } from '../domain/events';
import { firstNameOf, formatLeadCode } from '../domain/lead';
import { refreshLeadContactState } from '../../compliance';
import { formatName } from '../../normalization';
import { auditLead, queueDuplicateCheck, recordLeadEvent } from '../infra/events';
import { entryStage } from '../infra/stage-entry';
import { blockingDuplicates, findDuplicateLeads, PossibleDuplicateError } from './duplicates';
import {
  normalizeContactValue,
  resolveLeadFields,
  type LeadFieldValues,
  type NormalizedContact,
} from './normalize-input';

/** Tolerância para relógios adiantados ao informar a data da coleta. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/** Valida o responsável indicado no cadastro ou na atribuição. */
export async function resolveOwner(
  ctx: UseCaseContext,
  requested: string | null | undefined,
  path: string,
): Promise<string | null> {
  const actor = ctx.actor;
  if (requested === undefined) {
    // Padrão: SDR e Comercial ficam com o lead que cadastram; gestão decide depois.
    return actor.kind === 'user' && (actor.role === 'SDR' || actor.role === 'SALES')
      ? actor.id
      : null;
  }
  if (requested === null) return null;
  const canAssign = actor.kind !== 'user' || roleHasPermission(actor.role, 'lead.assign');
  if (!canAssign && !(actor.kind === 'user' && requested === actor.id)) {
    throw new ForbiddenError('Você só pode cadastrar leads para você mesmo.');
  }
  const owner = await ctx.tx.user.findUnique({
    where: { id: requested },
    select: { status: true },
  });
  if (!owner || owner.status !== 'ACTIVE') {
    throw new ValidationError([{ path, message: 'Responsável não encontrado ou inativo.' }]);
  }
  return requested;
}

type CreateLeadParsed = typeof createLeadInput._zod.output;

/** Contato normalizado e pronto para gravar. */
type PreparedContact = NormalizedContact & {
  label: string | null;
  isPrimary: boolean;
  isWhatsapp: boolean;
  personIndex?: number;
};

/** Cadastro validado e normalizado, pronto para `insertLead`. */
export interface PreparedLead {
  input: CreateLeadParsed;
  fields: LeadFieldValues;
  contacts: PreparedContact[];
  tagIds: string[];
  ownerId: string | null;
  sourceKey: string;
}

/**
 * Valida e normaliza um cadastro (campos, origem, base legal, contatos,
 * tags e responsável), com todos os erros juntos, por campo. Usado pelo
 * cadastro manual e pela importação.
 */
export async function prepareLeadCreation(
  ctx: UseCaseContext,
  input: CreateLeadParsed,
): Promise<PreparedLead> {
  const { data: fields, defaultDdd } = await resolveLeadFields(ctx.tx, ctx.deps.identifiers, input);
  const issues: ValidationIssue[] = [];

  const source = await ctx.tx.leadSource.findUnique({ where: { id: input.origin.sourceId } });
  if (!source || !source.active) {
    issues.push({ path: 'origin.sourceId', message: 'Origem não encontrada.' });
  }
  if (input.origin.collectedAt.getTime() > ctx.now.getTime() + FUTURE_TOLERANCE_MS) {
    issues.push({ path: 'origin.collectedAt', message: 'A data da coleta não pode ser futura.' });
  }
  if (input.legalBasisAssessmentId) {
    const assessment = await ctx.tx.legalBasisAssessment.findUnique({
      where: { id: input.legalBasisAssessmentId },
    });
    if (!assessment || !assessment.active) {
      issues.push({ path: 'legalBasisAssessmentId', message: 'Avaliação não encontrada.' });
    }
  }

  if (input.people.filter((p) => p.isPrimary).length > 1) {
    issues.push({ path: 'people', message: 'Marque só uma pessoa como principal.' });
  }

  const contacts: PreparedContact[] = [];
  const seen = new Set<string>();
  input.contactPoints.forEach((cp, index) => {
    const normalized = normalizeContactValue(cp.type, cp.value, defaultDdd);
    if (!normalized.ok) {
      issues.push({ path: `contactPoints.${index}.value`, message: normalized.message });
      return;
    }
    const key = `${cp.type}:${normalized.value.valueNormalized}`;
    if (seen.has(key)) {
      issues.push({ path: `contactPoints.${index}.value`, message: 'Contato repetido.' });
      return;
    }
    seen.add(key);
    if (cp.personIndex !== undefined && cp.personIndex >= input.people.length) {
      issues.push({ path: `contactPoints.${index}.personIndex`, message: 'Pessoa inválida.' });
    }
    contacts.push({
      ...normalized.value,
      label: cp.label ?? null,
      isPrimary: cp.isPrimary,
      isWhatsapp: cp.type === 'PHONE' && cp.isWhatsapp,
      personIndex: cp.personIndex,
    });
  });
  for (const type of ['PHONE', 'EMAIL', 'INSTAGRAM'] as const) {
    const ofType = contacts.filter((c) => c.type === type);
    if (ofType.filter((c) => c.isPrimary).length > 1) {
      issues.push({ path: 'contactPoints', message: 'Marque só um contato principal por tipo.' });
    } else if (ofType.length > 0 && !ofType.some((c) => c.isPrimary)) {
      ofType[0]!.isPrimary = true;
    }
  }

  const tagIds = [...new Set(input.tagIds)];
  if (tagIds.length > 0) {
    const found = await ctx.tx.tag.count({ where: { id: { in: tagIds }, active: true } });
    if (found !== tagIds.length) issues.push({ path: 'tagIds', message: 'Tag não encontrada.' });
  }
  if (issues.length > 0) throw new ValidationError(issues);

  const ownerId = await resolveOwner(ctx, input.ownerId, 'ownerId');
  return { input, fields, contacts, tagIds, ownerId, sourceKey: source!.key };
}

/**
 * Grava um cadastro preparado: lead, pessoas, contatos, origem, base legal,
 * tags, responsável, situação de contato, timeline e auditoria.
 */
export async function insertLead(
  ctx: UseCaseContext,
  prepared: PreparedLead,
  options: {
    createdVia: 'MANUAL' | 'IMPORT';
    importBatchId?: string;
    /** Avisos de duplicidade confirmados (cadastro) ou sinalizados (importação). */
    duplicateCodes?: string[];
    customFields?: Record<string, string> | null;
  },
): Promise<{ id: string; code: string; contactStatus: ContactStatus }> {
  const { input, fields, contacts, tagIds, ownerId } = prepared;
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
  const stage = await entryStage(ctx.tx);
  const lead = await ctx.tx.lead.create({
    data: {
      companyName: fields.companyName ?? null,
      tradeName: fields.tradeName ?? null,
      displayName: fields.displayName!,
      nameSearch: fields.nameSearch!,
      nameCore: fields.nameCore!,
      leadType: input.leadType ?? 'ACCOUNTING_FIRM',
      segmentId: fields.segmentId ?? null,
      category: fields.category ?? null,
      cnpj: fields.cnpj ?? null,
      cnpjRoot: fields.cnpjRoot ?? null,
      cnpjHash: fields.cnpjHash ?? null,
      addressLine: fields.addressLine ?? null,
      addressNumber: fields.addressNumber ?? null,
      addressComplement: fields.addressComplement ?? null,
      neighborhood: fields.neighborhood ?? null,
      cityRaw: fields.cityRaw ?? null,
      municipalityCode: fields.municipalityCode ?? null,
      stateUf: fields.stateUf ?? null,
      postalCode: fields.postalCode ?? null,
      websiteUrl: fields.websiteUrl ?? null,
      websiteDomain: fields.websiteDomain ?? null,
      description: fields.description ?? null,
      ...(options.customFields ? { customFields: options.customFields } : {}),
      originSourceId: input.origin.sourceId,
      originDetail: input.origin.detail ?? null,
      originUrl: input.origin.url ?? null,
      collectedAt: input.origin.collectedAt,
      createdVia: options.createdVia,
      ownerId,
      assignedAt: ownerId ? ctx.now : null,
      lastActivityAt: ctx.now,
      createdById: actorId,
      createdAt: ctx.now,
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      stageEnteredAt: ctx.now,
    },
    select: { id: true, code: true },
  });
  await ctx.tx.leadStageHistory.create({
    data: {
      leadId: lead.id,
      toStageId: stage.id,
      changedById: actorId,
      automationSource: options.createdVia === 'IMPORT' ? 'IMPORT' : null,
      enteredAt: ctx.now,
    },
  });

  const personIds = input.people.map(() => newId());
  const primaryPerson = input.people.findIndex((p) => p.isPrimary);
  if (input.people.length > 0) {
    await ctx.tx.leadPerson.createMany({
      data: input.people.map((person, index) => ({
        id: personIds[index],
        leadId: lead.id,
        fullName: formatName(person.fullName),
        firstName: firstNameOf(formatName(person.fullName)),
        roleTitle: person.roleTitle ?? null,
        isPrimary: primaryPerson === -1 ? index === 0 : index === primaryPerson,
        isDecisionMaker: person.isDecisionMaker,
        notes: person.notes ?? null,
        createdById: actorId,
      })),
    });
  }

  if (contacts.length > 0) {
    await ctx.tx.contactPoint.createMany({
      data: contacts.map((cp) => ({
        leadId: lead.id,
        personId: cp.personIndex !== undefined ? personIds[cp.personIndex] : null,
        type: cp.type,
        valueRaw: cp.valueRaw,
        valueNormalized: cp.valueNormalized,
        valueHash: ctx.deps.identifiers.hash(cp.type, cp.valueNormalized),
        label: cp.label,
        phoneKind: cp.phoneKind,
        whatsappStatus: cp.isWhatsapp ? 'PROBABLE' : 'UNKNOWN',
        isPrimary: cp.isPrimary,
        sourceId: input.origin.sourceId,
        sourceDetail: input.origin.detail ?? null,
        collectedAt: input.origin.collectedAt,
        normalizationFlags: cp.flags,
        createdById: actorId,
      })),
    });
  }

  await ctx.tx.leadOrigin.create({
    data: {
      leadId: lead.id,
      sourceId: input.origin.sourceId,
      detail: input.origin.detail ?? null,
      url: input.origin.url ?? null,
      collectedAt: input.origin.collectedAt,
      referrerName: input.origin.referrerName ?? null,
      isFirstTouch: true,
      importBatchId: options.importBatchId ?? null,
      createdById: actorId,
    },
  });

  await ctx.tx.contactPermission.create({
    data: {
      leadId: lead.id,
      channel: 'ALL',
      legalBasis: input.legalBasis,
      legalBasisAssessmentId: input.legalBasisAssessmentId ?? null,
      evidence: input.legalBasisEvidence ?? null,
      recordedById: actorId,
      recordedAt: ctx.now,
    },
  });

  if (tagIds.length > 0) {
    await ctx.tx.leadTag.createMany({
      data: tagIds.map((tagId) => ({ leadId: lead.id, tagId, addedById: actorId })),
    });
  }

  if (ownerId) {
    await ctx.tx.leadAssignment.create({
      data: {
        leadId: lead.id,
        toUserId: ownerId,
        strategy: options.createdVia === 'IMPORT' ? 'IMPORT' : 'MANUAL',
        assignedById: actorId,
        assignedAt: ctx.now,
      },
    });
  }

  const code = formatLeadCode(lead.code);
  const duplicateCodes = options.duplicateCodes ?? [];
  await recordLeadEvent(ctx, lead.id, LEAD_EVENTS.created, {
    payload: {
      code,
      createdVia: options.createdVia,
      sourceKey: prepared.sourceKey,
      legalBasis: input.legalBasis,
      people: input.people.length,
      contactPoints: contacts.length,
      duplicatesAcknowledged: duplicateCodes,
      ...(options.importBatchId ? { importBatchId: options.importBatchId } : {}),
    },
  });
  // Depois do evento de cadastro: caches de contato e o primeiro score.
  const contactStatus = await refreshLeadContactState(ctx.tx, lead.id, ctx.now);
  await auditLead(ctx, lead.id, 'lead.create', {
    changes: {
      displayName: [null, fields.displayName],
      cnpj: [null, fields.cnpj ?? null],
      municipalityCode: [null, fields.municipalityCode ?? null],
      originSource: [null, prepared.sourceKey],
      legalBasis: [null, input.legalBasis],
      ownerId: [null, ownerId],
    },
    metadata: {
      code,
      duplicatesAcknowledged: duplicateCodes,
      ...(options.importBatchId ? { importBatchId: options.importBatchId } : {}),
    },
  });

  return { id: lead.id, code, contactStatus };
}

export const createLead = defineUseCase({
  name: 'leads.create',
  access: 'lead.create',
  input: createLeadInput,
  async run(ctx, input) {
    const prepared = await prepareLeadCreation(ctx, input);
    const duplicates = await findDuplicateLeads(ctx, {
      cnpj: prepared.fields.cnpj ?? null,
      contacts: prepared.contacts,
      websiteDomain: prepared.fields.websiteDomain ?? null,
      nameSearch: prepared.fields.nameSearch ?? null,
      municipalityCode: prepared.fields.municipalityCode ?? null,
    });
    const blocking = blockingDuplicates(duplicates);
    if (blocking.length > 0) {
      throw new PossibleDuplicateError(
        blocking,
        `Já existe um lead com este CNPJ (${blocking.map((d) => d.code).join(', ')}).`,
      );
    }
    if (duplicates.length > 0 && !input.acknowledgeDuplicates) {
      throw new PossibleDuplicateError(duplicates);
    }
    const lead = await insertLead(ctx, prepared, {
      createdVia: 'MANUAL',
      duplicateCodes: duplicates.map((d) => d.code),
    });
    // Duplicados por similaridade (os exatos já foram mostrados acima) vão para a fila de revisão.
    await queueDuplicateCheck(ctx, lead.id);
    return lead;
  },
});
