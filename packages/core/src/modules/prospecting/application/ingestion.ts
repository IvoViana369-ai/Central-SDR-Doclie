import { Prisma, type DbClient } from '@docline/db';
import { z } from 'zod';
import { JOBS } from '../../../jobs/catalog';
import { CompanyRegistryError, type RegistryFile } from '../../../ports/company-registry';
import { systemActor, type Actor } from '../../../shared/actor';
import { BusinessRuleError } from '../../../shared/errors';
import {
  checkAccess,
  defineUseCase,
  toJson,
  type CoreDeps,
  type RequestMeta,
  type UseCaseContext,
} from '../../../shared/use-case';
import { MunicipalityIndex } from '../../normalization';
import { notify } from '../../notifications';
import {
  companyRootOf,
  mayBeAccountingLine,
  parseCompanyLine,
  parseEstablishmentLine,
  parseMunicipalityLine,
  readLatin1Lines,
  registryNameSearch,
  type ReceitaCompany,
  type ReceitaEstablishment,
} from '../domain/receita';
import {
  REGISTRY_SETTINGS_KEY,
  resolveRegistrySettings,
  type RegistrySettings,
} from '../domain/settings';

/**
 * Carga mensal da base aberta do CNPJ (F9-01; docs/INTEGRATIONS.md §9.1).
 *
 * 1. Todo dia, `registry.check` confere se a Receita publicou um mês novo e
 *    completo; se sim, abre a carga (uma de cada vez) e enfileira o job.
 * 2. `registry.ingest` lê os Estabelecimentos em streaming e grava só os
 *    ativos de contabilidade; depois lê as Empresas, mas só das raízes
 *    guardadas (razão social, natureza jurídica, porte).
 * 3. No fim, apaga o que saiu da base (baixados, mudaram de atividade) e os
 *    empresários individuais, se não estiverem liberados. Queda grande demais
 *    em relação à cópia atual não apaga nada: avisa os ADMINs.
 *
 * A carga interrompida (rede, worker reiniciado) retoma do arquivo em que
 * parou: os arquivos concluídos ficam em `progress.done` e as gravações são
 * idempotentes (chave pelo CNPJ).
 */

const BATCH_SIZE = 500;
/** Abaixo desta parcela da cópia atual, a carga não apaga nada (base suspeita). */
const MIN_KEPT_RATIO = 0.7;
/** Carga parada há mais que isso é dada como falha (a próxima conferência abre outra). */
const STALLED_HOURS = 72;

export interface IngestionStats {
  establishmentLines: number;
  kept: number;
  skipped: number;
  invalid: number;
  unmatchedMunicipalities: number;
  companiesMatched: number;
  removed: number;
  individualsRemoved: number;
  total: number;
  /** A queda em relação à cópia atual foi grande demais: nada foi apagado. */
  removalSkipped: boolean;
}

const EMPTY_STATS: IngestionStats = {
  establishmentLines: 0,
  kept: 0,
  skipped: 0,
  invalid: 0,
  unmatchedMunicipalities: 0,
  companiesMatched: 0,
  removed: 0,
  individualsRemoved: 0,
  total: 0,
  removalSkipped: false,
};

interface IngestionProgress {
  done: string[];
}

async function loadSettings(db: DbClient): Promise<RegistrySettings> {
  const row = await db.appSetting.findUnique({ where: { key: REGISTRY_SETTINGS_KEY } });
  return resolveRegistrySettings(row?.value);
}

async function notifyAdmins(
  ctx: UseCaseContext,
  input: { type: string; title: string; body?: string | null },
) {
  const admins = await ctx.tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  for (const admin of admins) {
    await notify(ctx.tx, { userId: admin.id, ...input, link: '/configuracoes/dados-cnpj' });
  }
}

// --- Abrir a carga ------------------------------------------------------------

const openIngestion = defineUseCase({
  name: 'registry.ingest.open',
  access: 'integration.manage',
  input: z.object({ provider: z.string(), reference: z.string(), force: z.boolean() }),
  async run(ctx, input) {
    const running = await ctx.tx.registryIngestion.findFirst({ where: { status: 'RUNNING' } });
    if (running) return { ingestionId: running.id, status: 'resumed' as const };
    if (!input.force) {
      const done = await ctx.tx.registryIngestion.findFirst({
        where: { status: 'SUCCEEDED', reference: input.reference },
        select: { id: true },
      });
      if (done) return { ingestionId: null, status: 'up_to_date' as const };
    }
    const ingestion = await ctx.tx.registryIngestion.create({
      data: {
        provider: input.provider,
        reference: input.reference,
        startedAt: ctx.now,
        stats: toJson(EMPTY_STATS),
        progress: toJson({ done: [] }),
        requestedById: ctx.actor.kind === 'user' ? ctx.actor.id : null,
      },
    });
    await ctx.audit({
      action: 'registry.ingest.start',
      entityType: 'registry_ingestion',
      entityId: ingestion.id,
      metadata: { reference: input.reference, provider: input.provider },
    });
    return { ingestionId: ingestion.id, status: 'started' as const };
  },
});

async function enqueueIngestion(deps: CoreDeps, ingestionId: string) {
  await deps.jobs.enqueue(
    JOBS.registryIngest.name,
    { ingestionId },
    { singletonKey: `registry-ingest:${ingestionId}` },
  );
}

const failStalled = defineUseCase({
  name: 'registry.ingest.stalled',
  access: 'integration.manage',
  input: z.object({ ingestionId: z.uuid() }),
  async run(ctx, input) {
    const changed = await ctx.tx.registryIngestion.updateMany({
      where: { id: input.ingestionId, status: 'RUNNING' },
      data: { status: 'FAILED', error: 'STALLED', finishedAt: ctx.now },
    });
    if (changed.count > 0) {
      await notifyAdmins(ctx, {
        type: 'registry.failed',
        title: 'A carga da base do CNPJ parou',
        body: `Sem conseguir terminar em ${STALLED_HOURS} h. A próxima conferência tenta de novo.`,
      });
    }
  },
});

/**
 * Confere o mês mais recente e, se for novo (ou `force`), abre a carga. Usado
 * pelo job diário e pelo botão do ADMIN.
 */
export async function startRegistryIngestion(
  deps: CoreDeps,
  actor: Actor,
  input: { force?: boolean } = {},
  meta: RequestMeta = {},
) {
  checkAccess(actor, 'integration.manage');
  const source = deps.companyRegistry;
  if (!source) {
    throw new BusinessRuleError('A base aberta do CNPJ está desligada neste ambiente.');
  }
  const running = await deps.db.registryIngestion.findFirst({ where: { status: 'RUNNING' } });
  if (running) {
    const age = deps.clock.now().getTime() - running.startedAt.getTime();
    if (age > STALLED_HOURS * 3_600_000) {
      await failStalled(deps, actor, { ingestionId: running.id }, meta);
    } else {
      await enqueueIngestion(deps, running.id);
      return { status: 'resumed' as const, ingestionId: running.id, reference: running.reference };
    }
  }
  let reference: string;
  try {
    reference = await source.latestReference();
    // Só abre com a publicação completa (a listagem confere).
    await source.listFiles(reference);
  } catch (error) {
    if (error instanceof CompanyRegistryError) {
      return {
        status: 'not_published' as const,
        ingestionId: null,
        reference: null,
        message: error.message,
      };
    }
    throw error;
  }
  const opened = await openIngestion(
    deps,
    actor,
    { provider: source.name, reference, force: input.force ?? false },
    meta,
  );
  if (opened.ingestionId) await enqueueIngestion(deps, opened.ingestionId);
  return { ...opened, reference };
}

/** Job `registry.check` (diário). */
export async function runRegistryCheck(deps: CoreDeps) {
  if (!deps.companyRegistry) return { status: 'disabled' as const };
  const settings = await loadSettings(deps.db);
  if (!settings.monthlyIngestion) return { status: 'disabled' as const };
  return startRegistryIngestion(deps, systemActor('registry.check'));
}

// --- Carga ----------------------------------------------------------------------

async function upsertEstablishments(
  db: DbClient,
  rows: (ReceitaEstablishment & { municipalityCode: number | null; cityName: string | null })[],
  reference: string,
  now: Date,
) {
  if (rows.length === 0) return;
  const values = rows.map(
    (r) => Prisma.sql`(
      ${r.cnpj}, ${r.cnpjRoot}, ${r.isHeadOffice}, ${r.tradeName},
      ${registryNameSearch(r.tradeName, null)}, ${r.cnaeMain}, ${r.cnaesSecondary}::text[],
      ${r.openedAt}::date, ${r.municipalityCode}::int, ${r.receitaMunicipalityCode}::int,
      ${r.cityName}, ${r.uf}, ${r.addressLine}, ${r.addressNumber}, ${r.addressComplement},
      ${r.neighborhood}, ${r.postalCode}, ${r.phone1}, ${r.phone2}, ${r.email},
      ${reference}, ${now}::timestamptz
    )`,
  );
  await db.$executeRaw`
    INSERT INTO registry_companies (
      cnpj, cnpj_root, is_head_office, trade_name, name_search, cnae_main, cnaes_secondary,
      opened_at, municipality_code, receita_municipality_code, city_name, uf, address_line,
      address_number, address_complement, neighborhood, postal_code, phone_1, phone_2, email,
      dataset_reference, ingested_at
    ) VALUES ${Prisma.join(values)}
    ON CONFLICT (cnpj) DO UPDATE SET
      cnpj_root = EXCLUDED.cnpj_root,
      is_head_office = EXCLUDED.is_head_office,
      trade_name = EXCLUDED.trade_name,
      name_search = CASE
        WHEN EXCLUDED.trade_name IS NOT NULL THEN EXCLUDED.name_search
        ELSE registry_companies.name_search
      END,
      cnae_main = EXCLUDED.cnae_main,
      cnaes_secondary = EXCLUDED.cnaes_secondary,
      opened_at = EXCLUDED.opened_at,
      municipality_code = EXCLUDED.municipality_code,
      receita_municipality_code = EXCLUDED.receita_municipality_code,
      city_name = EXCLUDED.city_name,
      uf = EXCLUDED.uf,
      address_line = EXCLUDED.address_line,
      address_number = EXCLUDED.address_number,
      address_complement = EXCLUDED.address_complement,
      neighborhood = EXCLUDED.neighborhood,
      postal_code = EXCLUDED.postal_code,
      phone_1 = EXCLUDED.phone_1,
      phone_2 = EXCLUDED.phone_2,
      email = EXCLUDED.email,
      dataset_reference = EXCLUDED.dataset_reference,
      ingested_at = EXCLUDED.ingested_at
  `;
}

async function updateCompanies(db: DbClient, rows: ReceitaCompany[]) {
  if (rows.length === 0) return;
  const values = rows.map(
    // Valores numa lista VALUES chegam sem tipo: os casts dizem ao Postgres.
    (c) => Prisma.sql`(
      ${c.cnpjRoot}::text, ${c.companyName}::text, ${c.legalNature}::text,
      ${c.isIndividualEntrepreneur}::boolean, ${c.companySize}::text,
      ${registryNameSearch(null, c.companyName)}::text
    )`,
  );
  await db.$executeRaw`
    UPDATE registry_companies r SET
      company_name = v.company_name,
      legal_nature = v.legal_nature,
      is_individual_entrepreneur = v.individual,
      company_size = v.company_size,
      name_search = CASE WHEN r.trade_name IS NULL THEN v.name_search ELSE r.name_search END
    FROM (VALUES ${Prisma.join(values)})
      AS v(cnpj_root, company_name, legal_nature, individual, company_size, name_search)
    WHERE r.cnpj_root = v.cnpj_root
  `;
}

async function saveProgress(
  db: DbClient,
  ingestionId: string,
  progress: IngestionProgress,
  stats: IngestionStats,
) {
  await db.registryIngestion.update({
    where: { id: ingestionId },
    data: { progress: toJson(progress), stats: toJson(stats), error: null },
  });
}

const finishIngestion = defineUseCase({
  name: 'registry.ingest.finish',
  access: 'integration.manage',
  input: z.object({
    ingestionId: z.uuid(),
    stats: z.record(z.string(), z.unknown()),
    includeIndividuals: z.boolean(),
  }),
  async run(ctx, input) {
    const row = await ctx.tx.registryIngestion.findUniqueOrThrow({
      where: { id: input.ingestionId },
    });
    if (row.status !== 'RUNNING') return { status: row.status };
    const stats = { ...EMPTY_STATS, ...(input.stats as Partial<IngestionStats>) };
    if (!input.includeIndividuals) {
      stats.individualsRemoved = (
        await ctx.tx.registryCompany.deleteMany({ where: { isIndividualEntrepreneur: true } })
      ).count;
    }
    const current = await ctx.tx.registryCompany.count({
      where: { datasetReference: row.reference },
    });
    const stale = await ctx.tx.registryCompany.count({
      where: { datasetReference: { not: row.reference } },
    });
    // Base nova muito menor que a cópia atual: algo está errado na publicação.
    const suspicious = stale > 0 && current < (current + stale) * MIN_KEPT_RATIO;
    if (suspicious) {
      stats.removalSkipped = true;
    } else {
      stats.removed = (
        await ctx.tx.registryCompany.deleteMany({
          where: { datasetReference: { not: row.reference } },
        })
      ).count;
    }
    stats.total = await ctx.tx.registryCompany.count();
    await ctx.tx.registryIngestion.update({
      where: { id: row.id },
      data: { status: 'SUCCEEDED', stats: toJson(stats), finishedAt: ctx.now, error: null },
    });
    await ctx.audit({
      action: 'registry.ingest.finish',
      entityType: 'registry_ingestion',
      entityId: row.id,
      metadata: { reference: row.reference, ...stats },
    });
    if (suspicious) {
      await notifyAdmins(ctx, {
        type: 'registry.suspicious',
        title: `Base do CNPJ de ${row.reference} bem menor que a anterior`,
        body: 'Nada foi apagado da cópia atual. Confira a publicação da Receita antes da próxima carga.',
      });
    }
    if (row.requestedById) {
      await notify(ctx.tx, {
        userId: row.requestedById,
        type: 'registry.ingested',
        title: `Base do CNPJ de ${row.reference} carregada`,
        body: `${stats.total} escritórios de contabilidade ativos na base.`,
        link: '/configuracoes/dados-cnpj',
      });
    }
    return { status: 'SUCCEEDED' as const, stats };
  },
});

const failIngestion = defineUseCase({
  name: 'registry.ingest.fail',
  access: 'integration.manage',
  input: z.object({ ingestionId: z.uuid(), error: z.string(), message: z.string() }),
  async run(ctx, input) {
    const changed = await ctx.tx.registryIngestion.updateMany({
      where: { id: input.ingestionId, status: 'RUNNING' },
      data: { status: 'FAILED', error: input.error, finishedAt: ctx.now },
    });
    if (changed.count === 0) return;
    await ctx.audit({
      action: 'registry.ingest.fail',
      entityType: 'registry_ingestion',
      entityId: input.ingestionId,
      metadata: { error: input.error },
    });
    await notifyAdmins(ctx, {
      type: 'registry.failed',
      title: 'A carga da base do CNPJ falhou',
      body: input.message,
    });
  },
});

/** Primeira passagem: Estabelecimentos, com o município da Receita casado com o IBGE. */
async function ingestEstablishments(
  deps: CoreDeps,
  context: {
    ingestionId: string;
    reference: string;
    files: RegistryFile[];
    progress: IngestionProgress;
    stats: IngestionStats;
    settings: RegistrySettings;
  },
) {
  const source = deps.companyRegistry!;
  const { reference, progress, stats } = context;
  // Municípios da Receita → IBGE (pelo nome e a UF do estabelecimento).
  const receitaNames = new Map<number, string>();
  for (const file of context.files.filter((f) => f.kind === 'MUNICIPALITIES')) {
    for await (const line of readLatin1Lines(source.open(reference, file))) {
      const parsed = parseMunicipalityLine(line);
      if (parsed) receitaNames.set(parsed.code, parsed.name);
    }
  }
  const index = new MunicipalityIndex(
    await deps.db.municipality.findMany({
      select: { ibgeCode: true, name: true, uf: true, nameSearch: true, ddd: true },
    }),
  );
  const resolved = new Map<string, { code: number | null; name: string | null }>();
  const cityOf = (receitaCode: number, uf: string) => {
    const key = `${receitaCode}|${uf}`;
    let city = resolved.get(key);
    if (!city) {
      const name = receitaNames.get(receitaCode) ?? null;
      const match = name ? index.match(name, uf) : null;
      city =
        match?.status === 'MATCHED'
          ? { code: match.municipality.ibgeCode, name: match.municipality.name }
          : { code: null, name };
      resolved.set(key, city);
    }
    return city;
  };

  for (const file of context.files.filter((f) => f.kind === 'ESTABLISHMENTS')) {
    if (progress.done.includes(file.name)) continue;
    const fileStats = { lines: 0, kept: 0, skipped: 0, invalid: 0, unmatched: 0 };
    let batch: Parameters<typeof upsertEstablishments>[1] = [];
    const now = deps.clock.now();
    for await (const line of readLatin1Lines(source.open(reference, file))) {
      fileStats.lines += 1;
      if (!mayBeAccountingLine(line)) {
        fileStats.skipped += 1;
        continue;
      }
      const parsed = parseEstablishmentLine(line, {
        includeSecondaryCnae: context.settings.includeSecondaryCnae,
      });
      if (parsed.kind !== 'kept') {
        fileStats[parsed.kind] += 1;
        continue;
      }
      const city = cityOf(parsed.establishment.receitaMunicipalityCode, parsed.establishment.uf);
      if (city.code === null) fileStats.unmatched += 1;
      batch.push({ ...parsed.establishment, municipalityCode: city.code, cityName: city.name });
      fileStats.kept += 1;
      if (batch.length >= BATCH_SIZE) {
        await upsertEstablishments(deps.db, batch, reference, now);
        batch = [];
      }
    }
    await upsertEstablishments(deps.db, batch, reference, now);
    // Contadores somados só com o arquivo inteiro (a retomada refaz o arquivo).
    stats.establishmentLines += fileStats.lines;
    stats.kept += fileStats.kept;
    stats.skipped += fileStats.skipped;
    stats.invalid += fileStats.invalid;
    stats.unmatchedMunicipalities += fileStats.unmatched;
    progress.done.push(file.name);
    await saveProgress(deps.db, context.ingestionId, progress, stats);
  }
}

/** Segunda passagem: Empresas, só das raízes guardadas na primeira. */
async function ingestCompanies(
  deps: CoreDeps,
  context: {
    ingestionId: string;
    reference: string;
    files: RegistryFile[];
    progress: IngestionProgress;
    stats: IngestionStats;
  },
) {
  const source = deps.companyRegistry!;
  const { reference, progress, stats } = context;
  const pending = context.files.filter(
    (f) => f.kind === 'COMPANIES' && !progress.done.includes(f.name),
  );
  if (pending.length === 0) return;
  const roots = new Set(
    (
      await deps.db.registryCompany.findMany({
        where: { datasetReference: reference },
        select: { cnpjRoot: true },
        distinct: ['cnpjRoot'],
      })
    ).map((r) => r.cnpjRoot),
  );
  for (const file of pending) {
    let matched = 0;
    let batch: ReceitaCompany[] = [];
    for await (const line of readLatin1Lines(source.open(reference, file))) {
      const root = companyRootOf(line);
      if (!root || !roots.has(root)) continue;
      const company = parseCompanyLine(line);
      if (!company) continue;
      batch.push(company);
      matched += 1;
      if (batch.length >= BATCH_SIZE) {
        await updateCompanies(deps.db, batch);
        batch = [];
      }
    }
    await updateCompanies(deps.db, batch);
    stats.companiesMatched += matched;
    progress.done.push(file.name);
    await saveProgress(deps.db, context.ingestionId, progress, stats);
  }
}

/** Job `registry.ingest`: a carga de um mês (retoma do arquivo onde parou). */
export async function runRegistryIngestion(deps: CoreDeps, data: unknown) {
  const { ingestionId } = z.object({ ingestionId: z.uuid() }).parse(data);
  const row = await deps.db.registryIngestion.findUnique({ where: { id: ingestionId } });
  if (!row || row.status !== 'RUNNING') return { status: 'skipped' as const };
  const actor = systemActor('registry.ingest');
  if (!deps.companyRegistry) {
    await failIngestion(deps, actor, {
      ingestionId,
      error: 'DISABLED',
      message: 'A base aberta do CNPJ foi desligada no meio da carga.',
    });
    return { status: 'failed' as const };
  }
  const settings = await loadSettings(deps.db);
  const progress: IngestionProgress = {
    done: [...((row.progress as Partial<IngestionProgress> | null)?.done ?? [])],
  };
  const stats: IngestionStats = { ...EMPTY_STATS, ...(row.stats as Partial<IngestionStats>) };
  try {
    const files = await deps.companyRegistry.listFiles(row.reference);
    const context = { ingestionId, reference: row.reference, files, progress, stats };
    await ingestEstablishments(deps, { ...context, settings });
    await ingestCompanies(deps, context);
    const result = await finishIngestion(deps, actor, {
      ingestionId,
      stats: stats as unknown as Record<string, unknown>,
      includeIndividuals: settings.includeIndividualEntrepreneurs,
    });
    deps.logger.info({ ingestionId, reference: row.reference }, 'Base do CNPJ carregada');
    return { status: 'succeeded' as const, stats: 'stats' in result ? result.stats : null };
  } catch (error) {
    if (error instanceof CompanyRegistryError && error.code === 'UNAVAILABLE') {
      // Passageiro: a fila tenta de novo (retomando); depois, a conferência diária.
      await deps.db.registryIngestion.update({
        where: { id: ingestionId },
        data: { error: error.code },
      });
      throw error;
    }
    const code = error instanceof CompanyRegistryError ? error.code : 'UNEXPECTED';
    await failIngestion(deps, actor, {
      ingestionId,
      error: code,
      message:
        error instanceof CompanyRegistryError
          ? error.message
          : 'Erro inesperado na carga. Veja os logs do worker.',
    });
    if (!(error instanceof CompanyRegistryError)) throw error;
    return { status: 'failed' as const, code };
  }
}
