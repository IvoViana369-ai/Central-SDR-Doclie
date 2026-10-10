import type { Prisma } from '@docline/db';
import type { UseCaseContext } from '../../../shared/use-case';
import { buildLeadNames, firstNameOf } from '../../leads';
import { formatName, normalizeUrl, toSearchKey } from '../../normalization';
import type { NormalizedImportRow } from '../domain/row';

/** De onde vieram os dados que completam o lead (vão nos contatos novos). */
export interface LeadDataOrigin {
  sourceId: string | null;
  sourceDetail: string | null;
  collectedAt: Date | null;
}

/**
 * Completa um lead existente só nos campos vazios (nada é sobrescrito):
 * nomes, CNPJ (se livre), cidade, endereço, site, segmento, categoria,
 * descrição, campos extras, contatos novos e a pessoa. Usado pela importação
 * ("completar o existente") e pela Prospecção (dados abertos do CNPJ).
 * Devolve as mudanças para a auditoria; quem chama registra o evento.
 */
export async function fillEmptyLeadFields(
  ctx: UseCaseContext,
  batch: LeadDataOrigin,
  leadId: string,
  n: NormalizedImportRow,
) {
  const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
  const lead = await ctx.tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      companyName: true,
      tradeName: true,
      cnpj: true,
      municipalityCode: true,
      cityRaw: true,
      stateUf: true,
      postalCode: true,
      addressLine: true,
      addressNumber: true,
      addressComplement: true,
      neighborhood: true,
      websiteUrl: true,
      segmentId: true,
      category: true,
      description: true,
      customFields: true,
      contactPoints: {
        where: { status: { not: 'REMOVED' } },
        select: { type: true, valueNormalized: true },
      },
      people: { where: { status: 'ACTIVE' }, select: { fullName: true } },
    },
  });
  const data: Prisma.LeadUpdateInput = {};
  const changes: Record<string, [unknown, unknown]> = {};
  const fill = <K extends keyof typeof lead & keyof Prisma.LeadUpdateInput>(
    key: K,
    value: unknown,
  ) => {
    if ((lead[key] === null || lead[key] === undefined) && value !== null && value !== undefined) {
      (data as Record<string, unknown>)[key] = value;
      changes[key] = [null, value];
    }
  };
  fill('companyName', n.companyName);
  fill('tradeName', n.tradeName);
  if (changes.companyName || changes.tradeName) {
    // Nome exibido e chaves de busca acompanham o nome completado.
    const names = buildLeadNames({
      companyName: lead.companyName ?? n.companyName,
      tradeName: lead.tradeName ?? n.tradeName,
    });
    if (names) {
      Object.assign(data, {
        displayName: names.displayName,
        nameSearch: names.nameSearch,
        nameCore: names.nameCore,
      });
    }
  }
  if (!lead.cnpj && n.cnpj) {
    const taken = await ctx.tx.lead.count({ where: { cnpj: n.cnpj, status: { not: 'MERGED' } } });
    if (!taken) {
      Object.assign(data, {
        cnpj: n.cnpj,
        cnpjRoot: n.cnpjRoot,
        cnpjHash: ctx.deps.identifiers.hash('CNPJ', n.cnpj),
      });
      changes.cnpj = [null, n.cnpj];
    }
  }
  if (!lead.municipalityCode && n.municipalityCode) {
    data.municipality = { connect: { ibgeCode: n.municipalityCode } };
    data.cityRaw = n.cityName;
    data.state = n.stateUf ? { connect: { uf: n.stateUf } } : undefined;
    changes.municipalityCode = [null, n.municipalityCode];
  }
  fill('postalCode', n.postalCode);
  fill('addressLine', n.addressLine);
  fill('addressNumber', n.addressNumber);
  fill('addressComplement', n.addressComplement);
  fill('neighborhood', n.neighborhood);
  if (!lead.websiteUrl && n.website) {
    const url = normalizeUrl(n.website);
    if (url.ok) {
      // O domínio é o que a deduplicação compara (mesmo site).
      Object.assign(data, { websiteUrl: url.value.url, websiteDomain: url.value.domain });
      changes.websiteUrl = [null, url.value.url];
    }
  }
  if (!lead.segmentId && n.segmentId) {
    data.segment = { connect: { id: n.segmentId } };
    changes.segmentId = [null, n.segmentId];
  }
  fill('category', n.category);
  fill('description', n.description);
  const custom = (lead.customFields as Record<string, string> | null) ?? {};
  const newCustom = Object.fromEntries(
    Object.entries(n.customFields).filter(([k]) => !(k in custom)),
  );
  if (Object.keys(newCustom).length) data.customFields = { ...custom, ...newCustom };

  const existing = new Set(lead.contactPoints.map((c) => `${c.type}:${c.valueNormalized}`));
  const newContacts = n.contacts.filter((c) => !existing.has(`${c.type}:${c.value}`));
  if (newContacts.length) {
    await ctx.tx.contactPoint.createMany({
      data: newContacts.map((c) => ({
        leadId,
        type: c.type,
        valueRaw: c.value,
        valueNormalized: c.value,
        valueHash: ctx.deps.identifiers.hash(c.type, c.value),
        label: c.label,
        whatsappStatus: c.isWhatsapp ? ('PROBABLE' as const) : ('UNKNOWN' as const),
        sourceId: batch.sourceId,
        sourceDetail: batch.sourceDetail,
        collectedAt: batch.collectedAt,
        createdById: actorId,
      })),
      skipDuplicates: true,
    });
    changes.contactPoints = [null, newContacts.length];
  }
  if (
    n.person &&
    !lead.people.some((p) => toSearchKey(p.fullName) === toSearchKey(n.person!.fullName))
  ) {
    await ctx.tx.leadPerson.create({
      data: {
        leadId,
        fullName: formatName(n.person.fullName),
        firstName: firstNameOf(formatName(n.person.fullName)),
        roleTitle: n.person.roleTitle,
        isPrimary: lead.people.length === 0,
        createdById: actorId,
      },
    });
    changes.person = [null, 1];
  }
  if (Object.keys(data).length) {
    await ctx.tx.lead.update({
      where: { id: leadId },
      data: { ...data, version: { increment: 1 } },
    });
  }
  return changes;
}
