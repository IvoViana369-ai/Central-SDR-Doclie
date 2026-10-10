import { Prisma, type DbTransaction, type ImportMatchStatus } from '@docline/db';
import type { Actor } from '../../../shared/actor';
import {
  BusinessRuleError,
  isDomainError,
  NotFoundError,
  ValidationError,
} from '../../../shared/errors';
import {
  assertAccess,
  auditData,
  defineUseCase,
  toJson,
  type CoreDeps,
  type RequestMeta,
} from '../../../shared/use-case';
import { refreshLeadContactState } from '../../compliance';
import { detectDuplicates } from '../../dedup';
import {
  fillEmptyLeadFields,
  InFileIndex,
  matchRows,
  type MatchReason,
  type NormalizedImportRow,
  type RowMatch,
} from '../../import';
import {
  auditLead,
  createLeadInput,
  formatLeadCode,
  insertLead,
  LEAD_EVENTS,
  prepareLeadCreation,
  recordLeadEvent,
  touchLead,
} from '../../leads';
import { formatCnpj, toSearchKey } from '../../normalization';
import {
  approveProspectInput,
  approveProspectsInput,
  listProspectingSearchesInput,
  PROSPECTING_RETENTION_DAYS,
  prospectingSearchIdInput,
  rejectProspectsInput,
  searchProspectsInput,
} from '../contracts/schemas';
import {
  accountingSegmentId,
  REGISTRY_SELECT,
  REGISTRY_SOURCE_KEY,
  registryCity,
  registryOriginDetail,
  registryToRow,
  registryView,
  requireRegistrySource,
} from '../infra/registry-row';

/**
 * Prospecção na base aberta do CNPJ (F9-02; docs/INTEGRATIONS.md §9.1).
 *
 * - A **busca** escolhe escritórios da cópia local da base (UF, cidades, CNAE,
 *   só matriz, nome, quantidade) e os compara com a base de leads e com a Lista
 *   Não Contatar, com as mesmas regras da importação.
 * - Os resultados guardam só a referência (o CNPJ), a comparação e a decisão;
 *   os dados aparecem lidos da cópia da base. São apagados em 30 dias.
 * - Nada vira lead sem uma pessoa **aprovar**. Na aprovação, a comparação é
 *   refeita (a base pode ter mudado desde a busca): o que já existe é só
 *   completado nos campos vazios; o que está na Lista Não Contatar não entra.
 */

const DAY_MS = 86_400_000;

/** Motivos guardados no resultado: os da comparação e os avisos (opt-out de um canal). */
export type ProspectingReason = MatchReason | { rule: 'WARNING'; detail: string };

function reasonsOf(match: RowMatch): ProspectingReason[] {
  return [
    ...match.reasons,
    ...match.warnings.map((detail) => ({ rule: 'WARNING' as const, detail })),
  ];
}

/** Mês da última carga concluída (a busca só roda com a base carregada). */
async function latestDataset(tx: DbTransaction) {
  return tx.registryIngestion.findFirst({
    where: { status: 'SUCCEEDED' },
    orderBy: { finishedAt: 'desc' },
    select: { reference: true, finishedAt: true },
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Busca na base aberta e comparação com a base (F9-02). */
export const searchProspects = defineUseCase({
  name: 'prospecting.search',
  access: 'prospecting.run',
  input: searchProspectsInput,
  async run(ctx, input) {
    const dataset = await latestDataset(ctx.tx);
    if (!dataset) {
      throw new BusinessRuleError(
        'A base aberta do CNPJ ainda não foi carregada. O ADMIN roda a carga em Configurações → Dados abertos do CNPJ.',
      );
    }
    const where: Prisma.Sql[] = [Prisma.sql`rc.uf = ${input.uf}`];
    if (input.municipalityCodes.length > 0) {
      where.push(Prisma.sql`rc.municipality_code IN (${Prisma.join(input.municipalityCodes)})`);
    }
    if (input.cnae) {
      where.push(
        Prisma.sql`(rc.cnae_main = ${input.cnae} OR ${input.cnae} = ANY(rc.cnaes_secondary))`,
      );
    }
    if (input.headOfficeOnly) where.push(Prisma.sql`rc.is_head_office`);
    const nameKey = input.name ? toSearchKey(input.name) : '';
    if (nameKey) where.push(Prisma.sql`rc.name_search LIKE ${`%${escapeLike(nameKey)}%`}`);
    if (input.onlyNew) {
      where.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM leads l WHERE l.cnpj = rc.cnpj AND l.status <> 'MERGED'
      )`);
      where.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM prospecting_results pr
        WHERE pr.provider_ref = rc.cnpj AND pr.decision = 'REJECTED'
      )`);
    }
    const found = await ctx.tx.$queryRaw<{ cnpj: string }[]>`
      SELECT rc.cnpj FROM registry_companies rc
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY rc.city_name, rc.name_search, rc.cnpj
      LIMIT ${input.limit}`;

    const companies = await ctx.tx.registryCompany.findMany({
      where: { cnpj: { in: found.map((f) => f.cnpj) } },
      select: REGISTRY_SELECT,
    });
    const byCnpj = new Map(companies.map((c) => [c.cnpj, c]));
    const segmentId = await accountingSegmentId(ctx.tx);
    const rows: { id: string; rowNumber: number; normalized: NormalizedImportRow }[] = [];
    for (const { cnpj } of found) {
      const company = byCnpj.get(cnpj);
      const normalized = company ? registryToRow(company, segmentId) : null;
      if (normalized) rows.push({ id: cnpj, rowNumber: rows.length + 1, normalized });
    }
    const matches = await matchRows(
      ctx.tx,
      ctx.deps.identifiers,
      rows,
      new InFileIndex(),
      (first) => `Repetido nesta busca (${formatCnpj(rows[first - 1]!.id)})`,
    );

    const search = await ctx.tx.prospectingSearch.create({
      data: {
        provider: REGISTRY_SOURCE_KEY,
        params: toJson(input),
        datasetReference: dataset.reference,
        resultCount: rows.length,
        requestedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        createdAt: ctx.now,
      },
      select: { id: true },
    });
    const counts: Partial<Record<ImportMatchStatus, number>> = {};
    if (rows.length > 0) {
      await ctx.tx.prospectingResult.createMany({
        data: rows.map((row) => {
          const match = matches.get(row.id)!;
          counts[match.status] = (counts[match.status] ?? 0) + 1;
          return {
            searchId: search.id,
            providerRef: row.id,
            matchStatus: match.status,
            matchedLeadId: match.matchedLeadId,
            matchReasons: toJson(reasonsOf(match)),
            createdAt: ctx.now,
          };
        }),
      });
    }
    await ctx.audit({
      action: 'prospecting.search',
      entityType: 'prospecting_search',
      entityId: search.id,
      metadata: {
        params: input,
        resultCount: rows.length,
        counts,
        datasetReference: dataset.reference,
      },
    });
    return {
      searchId: search.id,
      resultCount: rows.length,
      counts,
      datasetReference: dataset.reference,
    };
  },
});

/** Busca com os resultados, os dados da base aberta e a comparação. */
export const getProspectingSearch = defineUseCase({
  name: 'prospecting.get',
  access: 'prospecting.run',
  input: prospectingSearchIdInput,
  async run(ctx, input) {
    const search = await ctx.tx.prospectingSearch.findUnique({
      where: { id: input.searchId },
      select: {
        id: true,
        provider: true,
        params: true,
        datasetReference: true,
        resultCount: true,
        createdAt: true,
        purgedAt: true,
        requestedBy: { select: { id: true, name: true } },
      },
    });
    if (!search) throw new NotFoundError('Busca não encontrada.');
    const results = await ctx.tx.prospectingResult.findMany({
      where: { searchId: search.id },
      select: {
        id: true,
        providerRef: true,
        matchStatus: true,
        matchReasons: true,
        decision: true,
        decidedAt: true,
        rejectReason: true,
        decidedBy: { select: { name: true } },
        matchedLead: { select: { id: true, code: true, displayName: true, status: true } },
        createdLead: { select: { id: true, code: true, displayName: true } },
      },
    });
    const refs = results.map((r) => r.providerRef);
    // Em sequência: consultas simultâneas na mesma transação disputam a conexão.
    const companies = await ctx.tx.registryCompany.findMany({
      where: { cnpj: { in: refs } },
      select: REGISTRY_SELECT,
    });
    const rejectedElsewhere = await ctx.tx.prospectingResult.findMany({
      where: { providerRef: { in: refs }, decision: 'REJECTED', searchId: { not: search.id } },
      select: { providerRef: true },
      distinct: ['providerRef'],
    });
    const byCnpj = new Map(companies.map((c) => [c.cnpj, c]));
    const rejected = new Set(rejectedElsewhere.map((r) => r.providerRef));
    const items = results.map((r) => {
      const company = byCnpj.get(r.providerRef);
      return {
        id: r.id,
        cnpj: r.providerRef,
        /** Nulo: o escritório saiu da base aberta (baixado ou mudou de atividade). */
        company: company ? registryView(company) : null,
        sortKey: company
          ? `${registryCity(company) ?? ''}|${company.tradeName ?? company.companyName ?? ''}`
          : `~|${r.providerRef}`,
        matchStatus: r.matchStatus,
        reasons: r.matchReasons as unknown as ProspectingReason[],
        matchedLead: r.matchedLead
          ? { ...r.matchedLead, code: formatLeadCode(r.matchedLead.code) }
          : null,
        createdLead: r.createdLead
          ? { ...r.createdLead, code: formatLeadCode(r.createdLead.code) }
          : null,
        decision: r.decision,
        decidedAt: r.decidedAt,
        decidedBy: r.decidedBy?.name ?? null,
        rejectReason: r.rejectReason,
        rejectedBefore: rejected.has(r.providerRef),
      };
    });
    items.sort(
      (a, b) => a.sortKey.localeCompare(b.sortKey, 'pt-BR') || a.cnpj.localeCompare(b.cnpj),
    );
    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const item of items) counts[item.decision] += 1;
    return {
      search: { ...search, requestedBy: search.requestedBy?.name ?? null },
      results: items.map(({ sortKey: _sortKey, ...item }) => item),
      counts,
    };
  },
});

/** Últimas buscas, com as decisões de cada uma. */
export const listProspectingSearches = defineUseCase({
  name: 'prospecting.list',
  access: 'prospecting.run',
  input: listProspectingSearchesInput,
  async run(ctx, input) {
    const searches = await ctx.tx.prospectingSearch.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
      select: {
        id: true,
        params: true,
        datasetReference: true,
        resultCount: true,
        createdAt: true,
        purgedAt: true,
        requestedBy: { select: { name: true } },
      },
    });
    const grouped = await ctx.tx.prospectingResult.groupBy({
      by: ['searchId', 'decision'],
      where: { searchId: { in: searches.map((s) => s.id) } },
      _count: { _all: true },
    });
    return searches.map((s) => {
      const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
      for (const g of grouped) if (g.searchId === s.id) counts[g.decision] = g._count._all;
      return { ...s, requestedBy: s.requestedBy?.name ?? null, counts };
    });
  },
});

/**
 * Aprova um resultado (transação própria): cria o lead, com origem "Dados
 * abertos CNPJ", ou completa o lead que já existe. A decisão é reservada antes
 * (dois cliques ou duas pessoas não criam dois leads).
 */
export const approveProspect = defineUseCase({
  name: 'prospecting.approve',
  access: 'prospecting.run',
  input: approveProspectInput,
  async run(ctx, input) {
    const actorId = ctx.actor.kind === 'user' ? ctx.actor.id : null;
    const result = await ctx.tx.prospectingResult.findFirst({
      where: { id: input.resultId, searchId: input.searchId },
      select: { id: true, providerRef: true },
    });
    if (!result) throw new NotFoundError('Resultado não encontrado.');
    const claimed = await ctx.tx.prospectingResult.updateMany({
      where: { id: result.id, decision: 'PENDING' },
      data: { decision: 'APPROVED', decidedById: actorId, decidedAt: ctx.now },
    });
    if (claimed.count === 0) return { result: 'skipped' as const, leadId: null };

    const company = await ctx.tx.registryCompany.findUnique({
      where: { cnpj: result.providerRef },
      select: REGISTRY_SELECT,
    });
    if (!company) {
      throw new BusinessRuleError(
        'Este escritório saiu da base aberta do CNPJ (baixado ou mudou de atividade).',
      );
    }
    const source = await requireRegistrySource(ctx.tx);
    const n = registryToRow(company, await accountingSegmentId(ctx.tx));
    if (!n) throw new BusinessRuleError('Escritório sem nome na base aberta.');
    // A base pode ter mudado desde a busca: compara de novo.
    const match = (
      await matchRows(
        ctx.tx,
        ctx.deps.identifiers,
        [{ id: company.cnpj, rowNumber: 1, normalized: n }],
        new InFileIndex(),
      )
    ).get(company.cnpj)!;
    if (match.status === 'SUPPRESSED') {
      throw new BusinessRuleError('Está na Lista Não Contatar: não pode virar lead.');
    }
    const origin = {
      sourceId: source.id,
      sourceDetail: registryOriginDetail(company.datasetReference),
      collectedAt: company.ingestedAt,
    };

    let leadId: string;
    let outcome: 'created' | 'completed';
    if (match.status === 'EXISTING' && match.matchedLeadId) {
      leadId = match.matchedLeadId;
      const changes = await fillEmptyLeadFields(ctx, origin, leadId, n);
      await ctx.tx.leadOrigin.create({
        data: {
          leadId,
          sourceId: origin.sourceId,
          detail: origin.sourceDetail,
          collectedAt: origin.collectedAt,
          createdById: actorId,
        },
      });
      const fields = Object.keys(changes);
      if (fields.length > 0) {
        await detectDuplicates(ctx.tx, { kind: 'leads', ids: [leadId] }, 'PROSPECTING', ctx.now);
      }
      await refreshLeadContactState(ctx.tx, leadId, ctx.now);
      await recordLeadEvent(
        ctx,
        leadId,
        fields.length ? LEAD_EVENTS.updated : LEAD_EVENTS.originAdded,
        {
          payload: { sourceKey: REGISTRY_SOURCE_KEY, prospectingSearchId: input.searchId, fields },
        },
      );
      await touchLead(ctx, leadId);
      await auditLead(ctx, leadId, 'lead.prospecting_update', {
        changes,
        metadata: { prospectingSearchId: input.searchId, resultId: result.id },
      });
      outcome = 'completed';
    } else {
      const parsed = createLeadInput.parse({
        tradeName: n.tradeName,
        companyName: n.companyName,
        cnpj: n.cnpj,
        municipalityCode: n.municipalityCode,
        cityRaw: n.municipalityCode ? null : n.cityName,
        stateUf: n.municipalityCode ? null : n.stateUf,
        postalCode: n.postalCode,
        addressLine: n.addressLine,
        addressNumber: n.addressNumber,
        addressComplement: n.addressComplement,
        neighborhood: n.neighborhood,
        segmentId: n.segmentId,
        origin: {
          sourceId: origin.sourceId,
          detail: origin.sourceDetail,
          collectedAt: origin.collectedAt,
        },
        legalBasis: source.defaultLegalBasis,
        legalBasisAssessmentId: input.legalBasisAssessmentId,
        contactPoints: n.contacts.map((c) => ({
          type: c.type,
          value: c.value,
          isWhatsapp: c.isWhatsapp,
          label: c.label,
        })),
        tagIds: input.tagIds,
        ownerId: input.ownerId,
        acknowledgeDuplicates: true,
      });
      const prepared = await prepareLeadCreation(ctx, parsed);
      let duplicateCodes: string[] = [];
      if (match.matchedLeadId) {
        const matched = await ctx.tx.lead.findUnique({
          where: { id: match.matchedLeadId },
          select: { code: true },
        });
        if (matched) duplicateCodes = [formatLeadCode(matched.code)];
      }
      const lead = await insertLead(ctx, prepared, { createdVia: 'PROSPECTING', duplicateCodes });
      // Possíveis duplicados (filial, mesmo telefone) vão para a fila de revisão.
      await detectDuplicates(ctx.tx, { kind: 'leads', ids: [lead.id] }, 'PROSPECTING', ctx.now);
      leadId = lead.id;
      outcome = 'created';
    }

    await ctx.tx.prospectingResult.update({
      where: { id: result.id },
      data: {
        matchStatus: match.status,
        matchedLeadId: match.matchedLeadId,
        matchReasons: toJson(reasonsOf(match)),
        createdLeadId: outcome === 'created' ? leadId : null,
      },
    });
    await ctx.audit({
      action: 'prospecting.approve',
      entityType: 'prospecting_result',
      entityId: result.id,
      metadata: { searchId: input.searchId, outcome, leadId },
    });
    return { result: outcome, leadId };
  },
});

/**
 * Aprova vários resultados, um por transação: erro em um (saiu da base, entrou
 * na Lista Não Contatar, cadastro inválido) não derruba os outros.
 */
export async function approveProspects(
  deps: CoreDeps,
  actor: Actor,
  rawInput: unknown,
  meta: RequestMeta = {},
) {
  await assertAccess(deps, actor, 'prospecting.run', 'prospecting.approve', meta);
  const parsed = approveProspectsInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const { resultIds, ...rest } = parsed.data;
  const summary = {
    created: 0,
    completed: 0,
    skipped: 0,
    errors: [] as { resultId: string; message: string }[],
  };
  for (const resultId of [...new Set(resultIds)]) {
    try {
      const outcome = await approveProspect(deps, actor, { ...rest, resultId }, meta);
      summary[outcome.result] += 1;
    } catch (error) {
      if (!isDomainError(error)) {
        deps.logger.error({ err: error, resultId }, 'Falha ao aprovar resultado da prospecção');
      }
      const message = isDomainError(error)
        ? error instanceof ValidationError
          ? error.issues.map((i) => i.message).join(' ')
          : error.message
        : 'Erro inesperado ao aprovar.';
      summary.errors.push({ resultId, message });
    }
  }
  return summary;
}

/** Recusa resultados pendentes (com motivo opcional). */
export const rejectProspects = defineUseCase({
  name: 'prospecting.reject',
  access: 'prospecting.run',
  input: rejectProspectsInput,
  async run(ctx, input) {
    const search = await ctx.tx.prospectingSearch.count({ where: { id: input.searchId } });
    if (!search) throw new NotFoundError('Busca não encontrada.');
    const { count } = await ctx.tx.prospectingResult.updateMany({
      where: { searchId: input.searchId, id: { in: input.resultIds }, decision: 'PENDING' },
      data: {
        decision: 'REJECTED',
        decidedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
        decidedAt: ctx.now,
        rejectReason: input.reason || null,
      },
    });
    await ctx.audit({
      action: 'prospecting.reject',
      entityType: 'prospecting_search',
      entityId: input.searchId,
      metadata: { rejected: count, reason: input.reason || null },
    });
    return { rejected: count };
  },
});

/**
 * Job `prospecting.purge`: apaga os resultados das buscas com mais de 30 dias
 * (docs/LGPD.md §12). A busca fica no histórico, marcada como expirada.
 */
export async function runProspectingPurge(
  deps: CoreDeps,
): Promise<{ purgedSearches: number; deletedResults: number }> {
  const now = deps.clock.now();
  const before = new Date(now.getTime() - PROSPECTING_RETENTION_DAYS * DAY_MS);
  const expired = await deps.db.prospectingSearch.findMany({
    where: { createdAt: { lt: before }, purgedAt: null },
    select: { id: true },
  });
  let deletedResults = 0;
  for (const { id } of expired) {
    const [deleted] = await deps.db.$transaction([
      deps.db.prospectingResult.deleteMany({ where: { searchId: id } }),
      deps.db.prospectingSearch.update({ where: { id }, data: { purgedAt: now } }),
    ]);
    deletedResults += deleted.count;
  }
  if (expired.length > 0) {
    await deps.db.auditLog.create({
      data: auditData(
        { kind: 'system', name: 'prospecting.purge' },
        {},
        {
          action: 'prospecting.purge',
          entityType: 'prospecting_search',
          metadata: { purgedSearches: expired.length, deletedResults },
        },
      ),
    });
  }
  return { purgedSearches: expired.length, deletedResults };
}
