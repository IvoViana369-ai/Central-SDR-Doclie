import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { createLead, registerOptOut, type CreateLeadInput } from '../leads';
import {
  approveProspect,
  approveProspects,
  enrichLeadFromRegistry,
  FakeCompanyRegistrySource,
  fakeCnpj,
  getLeadRegistryData,
  getProspectingPotential,
  getProspectingSearch,
  listProspectingSearches,
  rejectProspects,
  runProspectingPurge,
  runRegistryIngestion,
  searchProspects,
  startRegistryIngestion,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, enqueued, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z');
deps.clock = { now: () => clockTime };
const SOBRAL = 2312908;
const FORTALEZA = 2304400;

/** Carrega a base aberta simulada (escritórios fictícios), como o worker faria. */
async function loadRegistry(admin: Actor) {
  deps.companyRegistry = new FakeCompanyRegistrySource();
  await startRegistryIngestion(deps, admin);
  for (const job of enqueued.filter((j) => j.name === 'registry.ingest')) {
    await runRegistryIngestion(deps, job.data);
  }
  enqueued.length = 0;
}

describe('Prospecção na base aberta do CNPJ (F9-02, F9-04, F9-05)', () => {
  let admin: UserActor;
  let manager: UserActor;
  let sourceId: string;
  const make = (name: string, overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [],
    acknowledgeDuplicates: true,
    ...overrides,
  });
  let alfaLeadId: string;
  let betaLookalikeId: string;

  beforeEach(async () => {
    clockTime = new Date('2026-10-13T12:00:00Z');
    await resetTestData(db);
    enqueued.length = 0;
    admin = (await createActor('ADMIN')).actor as UserActor;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    await loadRegistry(admin);
    // Base de leads: Alfa pelo CNPJ, outro nome com o telefone da Beta, Gama pelo
    // nome na cidade e um lead com o telefone da Delta que pediu opt-out.
    alfaLeadId = (
      await createLead(deps, manager, make('Alfa Antigo', { cnpj: fakeCnpj('FK000001') }))
    ).id;
    betaLookalikeId = (
      await createLead(
        deps,
        manager,
        make('Outro Escritório Qualquer', {
          contactPoints: [{ type: 'PHONE', value: '(88) 3611-0002' }],
        }),
      )
    ).id;
    await createLead(deps, manager, make('Gama Contadores Associados'));
    const delta = await createLead(
      deps,
      manager,
      make('Delta Antiga', { contactPoints: [{ type: 'PHONE', value: '(88) 3611-0004' }] }),
    );
    await registerOptOut(deps, manager, { leadId: delta.id });
    enqueued.length = 0;
  });
  afterAll(() => closeTestDb());

  it('busca: filtros, comparação com a base e com a Lista Não Contatar; nada vira lead sozinho', async () => {
    const leadsBefore = await db.lead.count();
    const search = await searchProspects(deps, manager, {
      uf: 'ce',
      municipalityCodes: [SOBRAL],
      onlyNew: false,
    });
    expect(search).toMatchObject({
      resultCount: 8,
      datasetReference: '2026-09',
      counts: { EXISTING: 2, POSSIBLE_DUPLICATE: 1, SUPPRESSED: 1, NEW: 4 },
    });
    expect(await db.lead.count()).toBe(leadsBefore);

    const view = await getProspectingSearch(deps, manager, { searchId: search.searchId });
    expect(view.counts).toEqual({ PENDING: 8, APPROVED: 0, REJECTED: 0 });
    expect(view.search).toMatchObject({ datasetReference: '2026-09', resultCount: 8 });
    const byCnpj = new Map(view.results.map((r) => [r.cnpj, r]));
    expect(byCnpj.get(fakeCnpj('FK000001'))).toMatchObject({
      matchStatus: 'EXISTING',
      matchedLead: { id: alfaLeadId, displayName: 'Alfa Antigo' },
      reasons: [expect.objectContaining({ rule: 'CNPJ' })],
      company: {
        tradeName: 'Escritório Contábil Alfa',
        companyName: 'Escritório Contábil Alfa Ltda',
        city: 'Sobral',
        uf: 'CE',
        phones: ['+558836110001'],
        email: 'contato@alfa-contabil.example',
        companySize: 'Microempresa',
        isHeadOffice: true,
      },
    });
    expect(byCnpj.get(fakeCnpj('FK000002'))).toMatchObject({
      matchStatus: 'POSSIBLE_DUPLICATE',
      matchedLead: { id: betaLookalikeId },
    });
    expect(byCnpj.get(fakeCnpj('FK000003'))?.matchStatus).toBe('EXISTING');
    expect(byCnpj.get(fakeCnpj('FK000004'))).toMatchObject({
      matchStatus: 'SUPPRESSED',
      reasons: expect.arrayContaining([expect.objectContaining({ rule: 'SUPPRESSED' })]),
    });
    // Ordem da tela: por cidade e nome.
    expect(view.results.map((r) => r.company?.tradeName)).toEqual([
      'Atlas Contadores Associados',
      'Beta Assessoria Contábil',
      'Contabilidade Delta',
      'Contabilidade Horizonte',
      'Escritório Contábil Alfa',
      'Escritório Contábil Ômega',
      'Gama Contadores Associados',
      'Sigma Assessoria Contábil',
    ]);
    // Os resultados guardam só a referência e a comparação (dados mascarados).
    const stored = JSON.stringify(await db.prospectingResult.findMany());
    expect(stored).not.toContain('contato@');
    expect(stored).not.toContain('Contábil');
    expect(stored).not.toContain('36110002');

    // Padrão: só o que ainda não é lead (sai a Alfa, que tem o mesmo CNPJ).
    expect(
      (await searchProspects(deps, manager, { uf: 'CE', municipalityCodes: [SOBRAL] })).resultCount,
    ).toBe(7);
    // CNAE 6920-6/02 no Ceará, nome, quantidade e filiais.
    expect((await searchProspects(deps, manager, { uf: 'CE', cnae: '6920602' })).resultCount).toBe(
      5,
    );
    expect(
      (await searchProspects(deps, manager, { uf: 'CE', name: 'Contadores' })).resultCount,
    ).toBe(6);
    expect((await searchProspects(deps, manager, { uf: 'CE', limit: 3 })).resultCount).toBe(3);
    const withBranches = await searchProspects(deps, manager, {
      uf: 'CE',
      municipalityCodes: [FORTALEZA],
      headOfficeOnly: false,
    });
    expect(withBranches.resultCount).toBe(10);
    const branch = (
      await getProspectingSearch(deps, manager, { searchId: withBranches.searchId })
    ).results.find((r) => r.cnpj === fakeCnpj('FK000001', '0002'));
    expect(branch).toMatchObject({
      matchStatus: 'POSSIBLE_DUPLICATE',
      reasons: [expect.objectContaining({ rule: 'CNPJ_ROOT' })],
      company: { isHeadOffice: false, city: 'Fortaleza' },
    });
    expect((await searchProspects(deps, manager, { uf: 'PI' })).resultCount).toBe(2);

    const history = await listProspectingSearches(deps, manager, {});
    expect(history).toHaveLength(7);
    expect(history.find((h) => h.id === search.searchId)).toMatchObject({
      resultCount: 8,
      counts: { PENDING: 8, APPROVED: 0, REJECTED: 0 },
    });
    expect(await db.auditLog.count({ where: { action: 'prospecting.search' } })).toBe(7);
  });

  it('aprovação: cria o lead com origem e contatos, completa o que já existe e respeita a Lista Não Contatar', async () => {
    const { searchId } = await searchProspects(deps, manager, {
      uf: 'CE',
      municipalityCodes: [SOBRAL],
      onlyNew: false,
    });
    const view = await getProspectingSearch(deps, manager, { searchId });
    const idOf = (root: string) => view.results.find((r) => r.cnpj === fakeCnpj(root))!.id;

    const summary = await approveProspects(deps, manager, {
      searchId,
      resultIds: view.results.map((r) => r.id),
    });
    expect(summary).toMatchObject({ created: 5, completed: 2, skipped: 0 });
    expect(summary.errors).toEqual([
      { resultId: idOf('FK000004'), message: 'Está na Lista Não Contatar: não pode virar lead.' },
    ]);

    // Novo: lead com a origem "Dados abertos CNPJ", contatos da Receita sem presumir WhatsApp.
    const horizonte = await db.lead.findFirstOrThrow({
      where: { cnpj: fakeCnpj('FK000008') },
      include: {
        contactPoints: true,
        origins: { include: { source: true } },
        permissions: true,
        segment: true,
      },
    });
    expect(horizonte).toMatchObject({
      tradeName: 'Contabilidade Horizonte',
      companyName: 'Contabilidade Horizonte Ltda',
      createdVia: 'PROSPECTING',
      municipalityCode: SOBRAL,
      postalCode: '62000008',
      ownerId: null,
      segment: { key: 'contabilidade' },
    });
    expect(horizonte.origins).toEqual([
      expect.objectContaining({
        isFirstTouch: true,
        detail: 'Base aberta do CNPJ (Receita Federal), mês 2026-09',
        source: expect.objectContaining({ key: 'CNPJ_OPEN_DATA' }),
      }),
    ]);
    expect(horizonte.permissions).toEqual([
      expect.objectContaining({ channel: 'ALL', legalBasis: 'LEGITIMATE_INTEREST' }),
    ]);
    expect(
      horizonte.contactPoints.map((c) => [c.type, c.valueNormalized, c.label, c.whatsappStatus]),
    ).toEqual(
      expect.arrayContaining([
        ['PHONE', '+558836110008', 'Cadastro na Receita', 'UNKNOWN'],
        ['PHONE', '+5588999900008', 'Cadastro na Receita', 'UNKNOWN'],
        ['EMAIL', 'contato@horizonte-contabil.example', 'Cadastro na Receita', 'UNKNOWN'],
      ]),
    );
    expect(horizonte.contactPoints).toHaveLength(3);

    // Já existia (CNPJ): só os campos vazios são completados; o nome fantasia fica.
    const alfa = await db.lead.findUniqueOrThrow({
      where: { id: alfaLeadId },
      include: { contactPoints: true, origins: { include: { source: true } } },
    });
    expect(alfa).toMatchObject({
      tradeName: 'Alfa Antigo',
      companyName: 'Escritório Contábil Alfa Ltda',
      postalCode: '62000001',
    });
    expect(alfa.contactPoints.map((c) => c.valueNormalized).sort()).toEqual([
      '+558836110001',
      'contato@alfa-contabil.example',
    ]);
    expect(alfa.origins.map((o) => o.source.key).sort()).toEqual(['CNPJ_OPEN_DATA', 'EVENT']);
    expect(
      await db.auditLog.count({
        where: { action: 'lead.prospecting_update', entityId: alfaLeadId },
      }),
    ).toBe(1);

    // Possível duplicado: o lead é criado e o par vai para a fila de revisão.
    const beta = await db.lead.findFirstOrThrow({ where: { cnpj: fakeCnpj('FK000002') } });
    expect(
      await db.duplicateCandidate.count({
        where: {
          detectedBy: 'PROSPECTING',
          OR: [
            { leadAId: beta.id, leadBId: betaLookalikeId },
            { leadAId: betaLookalikeId, leadBId: beta.id },
          ],
        },
      }),
    ).toBe(1);

    // Na Lista Não Contatar: nenhum lead, resultado continua pendente.
    expect(await db.lead.count({ where: { cnpj: fakeCnpj('FK000004') } })).toBe(0);
    const after = await getProspectingSearch(deps, manager, { searchId });
    expect(after.counts).toEqual({ PENDING: 1, APPROVED: 7, REJECTED: 0 });
    expect(after.results.find((r) => r.cnpj === fakeCnpj('FK000008'))).toMatchObject({
      decision: 'APPROVED',
      createdLead: { id: horizonte.id },
      decidedBy: expect.any(String),
    });
    expect(await db.auditLog.count({ where: { action: 'prospecting.approve' } })).toBe(7);

    // De novo: nada é criado duas vezes.
    const again = await approveProspects(deps, manager, {
      searchId,
      resultIds: view.results.map((r) => r.id),
    });
    expect(again).toMatchObject({ created: 0, completed: 0, skipped: 7 });
    expect(again.errors).toHaveLength(1);

    // Duas aprovações ao mesmo tempo do mesmo resultado: um lead só.
    const cedro = await searchProspects(deps, manager, { uf: 'CE', name: 'Cedro' });
    const [target] = (await getProspectingSearch(deps, manager, { searchId: cedro.searchId }))
      .results;
    const outcomes = await Promise.all([
      approveProspect(deps, manager, { searchId: cedro.searchId, resultId: target!.id }),
      approveProspect(deps, manager, { searchId: cedro.searchId, resultId: target!.id }),
    ]);
    expect(outcomes.map((o) => o.result).sort()).toEqual(['created', 'skipped']);
    expect(await db.lead.count({ where: { cnpj: target!.cnpj } })).toBe(1);
  });

  it('recusa, "recusado antes", saiu da base, base não carregada e permissões', async () => {
    const first = await searchProspects(deps, manager, { uf: 'CE', name: 'Contadores' });
    const results = (await getProspectingSearch(deps, manager, { searchId: first.searchId }))
      .results;
    expect(
      await rejectProspects(deps, manager, {
        searchId: first.searchId,
        resultIds: [results[0]!.id, results[1]!.id],
        reason: 'Fora do perfil',
      }),
    ).toEqual({ rejected: 2 });
    // Recusar de novo não muda nada; aprovar o recusado é ignorado.
    expect(
      await rejectProspects(deps, manager, {
        searchId: first.searchId,
        resultIds: [results[0]!.id],
      }),
    ).toEqual({ rejected: 0 });
    expect(
      await approveProspects(deps, manager, {
        searchId: first.searchId,
        resultIds: [results[0]!.id],
      }),
    ).toMatchObject({ created: 0, skipped: 1 });

    // A próxima busca deixa de fora os recusados; mostrando tudo, eles vêm marcados.
    expect(
      (await searchProspects(deps, manager, { uf: 'CE', name: 'Contadores' })).resultCount,
    ).toBe(4);
    const all = await searchProspects(deps, manager, {
      uf: 'CE',
      name: 'Contadores',
      onlyNew: false,
    });
    const marked = (await getProspectingSearch(deps, manager, { searchId: all.searchId })).results
      .filter((r) => r.rejectedBefore)
      .map((r) => r.cnpj);
    expect(marked.sort()).toEqual([results[0]!.cnpj, results[1]!.cnpj].sort());

    // Saiu da base aberta depois da busca: não vira lead e aparece sem os dados.
    const gone = results[2]!;
    await db.registryCompany.delete({ where: { cnpj: gone.cnpj } });
    expect(
      await approveProspects(deps, manager, { searchId: first.searchId, resultIds: [gone.id] }),
    ).toMatchObject({
      created: 0,
      errors: [{ message: expect.stringContaining('saiu da base aberta') }],
    });
    expect(
      (await getProspectingSearch(deps, manager, { searchId: first.searchId })).results.find(
        (r) => r.id === gone.id,
      ),
    ).toMatchObject({ company: null, decision: 'PENDING' });
    await expect(
      approveProspects(deps, manager, {
        searchId: all.searchId,
        resultIds: [results[3]!.id],
      }),
    ).resolves.toMatchObject({ errors: [{ message: 'Resultado não encontrado.' }] });

    const sdr = (await createActor('SDR')).actor;
    await expect(searchProspects(deps, sdr, { uf: 'CE' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      approveProspects(deps, sdr, { searchId: first.searchId, resultIds: [results[3]!.id] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getProspectingSearch(deps, sdr, { searchId: first.searchId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getProspectingSearch(deps, manager, { searchId: '00000000-0000-7000-8000-000000000000' }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Sem carga concluída, não há busca.
    await db.registryIngestion.updateMany({ data: { status: 'FAILED' } });
    await expect(searchProspects(deps, manager, { uf: 'CE' })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('retenção: os resultados das buscas com mais de 30 dias são apagados; a busca fica', async () => {
    const old = await searchProspects(deps, manager, { uf: 'CE', municipalityCodes: [SOBRAL] });
    clockTime = new Date('2026-11-01T12:00:00Z');
    const recent = await searchProspects(deps, manager, { uf: 'PI' });
    clockTime = new Date('2026-11-13T13:00:00Z');
    expect(await runProspectingPurge(deps)).toEqual({ purgedSearches: 1, deletedResults: 7 });
    expect(await db.prospectingResult.count({ where: { searchId: old.searchId } })).toBe(0);
    expect(await db.prospectingResult.count({ where: { searchId: recent.searchId } })).toBe(2);
    expect(
      await db.prospectingSearch.findUniqueOrThrow({ where: { id: old.searchId } }),
    ).toMatchObject({ resultCount: 7, purgedAt: clockTime });
    expect(await runProspectingPurge(deps)).toEqual({ purgedSearches: 0, deletedResults: 0 });
    expect(await db.auditLog.count({ where: { action: 'prospecting.purge' } })).toBe(1);
  });

  it('potencial por cidade: universo da base aberta × base de leads × contatados', async () => {
    await db.priorityCity.upsert({
      where: { municipalityCode: SOBRAL },
      create: { municipalityCode: SOBRAL },
      update: { active: true },
    });
    await db.lead.update({ where: { id: alfaLeadId }, data: { firstContactAt: clockTime } });
    const potential = await getProspectingPotential(deps, manager, { uf: 'CE' });
    expect(potential).toMatchObject({ uf: 'CE', datasetReference: '2026-09', unmatched: 1 });
    expect(potential.cities.map((c) => [c.name, c.offices, c.inBase, c.remaining])).toEqual([
      ['Fortaleza', 10, 0, 10],
      ['Sobral', 8, 1, 7],
      ['Juazeiro do Norte', 4, 0, 4],
      ['Crato', 3, 0, 3],
      ['Iguatu', 2, 0, 2],
    ]);
    expect(potential.cities.find((c) => c.name === 'Sobral')).toMatchObject({
      priority: true,
      leads: 4,
      contacted: 1,
      coverage: 1 / 8,
    });
    expect(potential.totals).toEqual({
      offices: 27,
      inBase: 1,
      remaining: 26,
      leads: 4,
      contacted: 1,
    });
    const sdr = (await createActor('SDR')).actor;
    await expect(getProspectingPotential(deps, sdr, { uf: 'CE' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('enriquecimento pelo CNPJ: completa só o vazio, sem contato da Lista Não Contatar, no escopo', async () => {
    const sdr = (await createActor('SDR')).actor as UserActor;
    // Telefone 2 da Horizonte na Lista Não Contatar (outro lead que pediu opt-out).
    const blocked = await createLead(
      deps,
      manager,
      make('Escritório Que Pediu Saída', {
        contactPoints: [{ type: 'PHONE', value: '(88) 99990-0008' }],
      }),
    );
    await registerOptOut(deps, manager, { leadId: blocked.id });
    const lead = await createLead(deps, sdr, {
      ...make('Horizonte', { cnpj: fakeCnpj('FK000008') }),
      municipalityCode: undefined,
    });

    const preview = await getLeadRegistryData(deps, sdr, { leadId: lead.id });
    expect(preview).toMatchObject({
      status: 'found',
      company: { tradeName: 'Contabilidade Horizonte', city: 'Sobral' },
      newContacts: 2,
      skippedSuppressed: 1,
    });
    expect(preview.fields).toEqual(
      expect.arrayContaining(['companyName', 'municipalityCode', 'postalCode', 'segmentId']),
    );
    expect(preview.fields).not.toContain('tradeName');

    const result = await enrichLeadFromRegistry(deps, sdr, { leadId: lead.id });
    expect(result).toMatchObject({ skippedSuppressed: 1, datasetReference: '2026-09' });
    expect(result.fields).toEqual(
      expect.arrayContaining(['companyName', 'municipalityCode', 'contactPoints']),
    );
    const enriched = await db.lead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { contactPoints: true, origins: { include: { source: true } } },
    });
    expect(enriched).toMatchObject({
      tradeName: 'Horizonte',
      companyName: 'Contabilidade Horizonte Ltda',
      municipalityCode: SOBRAL,
      postalCode: '62000008',
    });
    expect(enriched.contactPoints.map((c) => c.valueNormalized).sort()).toEqual([
      '+558836110008',
      'contato@horizonte-contabil.example',
    ]);
    expect(enriched.origins.map((o) => o.source.key).sort()).toEqual(['CNPJ_OPEN_DATA', 'EVENT']);
    expect(await db.leadEvent.count({ where: { leadId: lead.id, type: 'lead.updated' } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: 'lead.registry_enrich', entityId: lead.id } }),
    ).toBe(1);

    // De novo: nada a completar, nenhuma origem a mais.
    expect((await enrichLeadFromRegistry(deps, sdr, { leadId: lead.id })).fields).toEqual([]);
    expect(await db.leadOrigin.count({ where: { leadId: lead.id } })).toBe(2);

    // Sem CNPJ, CNPJ fora da base, fora do escopo, base não carregada.
    const noCnpj = await createLead(deps, sdr, make('Sem CNPJ Ltda'));
    expect(await getLeadRegistryData(deps, sdr, { leadId: noCnpj.id })).toMatchObject({
      status: 'no_cnpj',
    });
    await expect(enrichLeadFromRegistry(deps, sdr, { leadId: noCnpj.id })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    const outside = await createLead(
      deps,
      sdr,
      make('Fora da Base', { cnpj: fakeCnpj('FK000950') }),
    );
    expect(await getLeadRegistryData(deps, sdr, { leadId: outside.id })).toMatchObject({
      status: 'not_found',
    });
    await expect(enrichLeadFromRegistry(deps, sdr, { leadId: outside.id })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    const otherSdr = (await createActor('SDR')).actor;
    await expect(
      enrichLeadFromRegistry(deps, otherSdr, { leadId: lead.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await db.registryIngestion.updateMany({ data: { status: 'FAILED' } });
    expect(await getLeadRegistryData(deps, sdr, { leadId: lead.id })).toMatchObject({
      status: 'not_loaded',
    });
  });
});
