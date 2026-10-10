import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CompanyRegistryError, type RegistryFile } from '../../ports/company-registry';
import type { Actor } from '../../shared/actor';
import { BusinessRuleError, ForbiddenError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import {
  FakeCompanyRegistrySource,
  fakeCnpj,
  REGISTRY_SETTINGS_KEY,
  runRegistryCheck,
  runRegistryIngestion,
  startRegistryIngestion,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, enqueued, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z');
deps.clock = { now: () => clockTime };
const SOBRAL = 2312908;

/** Roda as cargas enfileiradas, como o worker. */
async function runQueued() {
  const jobs = enqueued.filter((j) => j.name === 'registry.ingest');
  enqueued.length = 0;
  const results = [];
  for (const job of jobs) results.push(await runRegistryIngestion(deps, job.data));
  return results;
}

async function setSettings(value: object) {
  await db.appSetting.upsert({
    where: { key: REGISTRY_SETTINGS_KEY },
    create: { key: REGISTRY_SETTINGS_KEY, value },
    update: { value },
  });
}

describe('base aberta do CNPJ: carga mensal (F9-01)', () => {
  let admin: UserActor;
  let source: FakeCompanyRegistrySource;

  beforeEach(async () => {
    clockTime = new Date('2026-10-13T12:00:00Z');
    await resetTestData(db);
    enqueued.length = 0;
    source = new FakeCompanyRegistrySource();
    deps.companyRegistry = source;
    admin = (await createActor('ADMIN')).actor as UserActor;
  });
  afterAll(() => closeTestDb());

  it('carga completa: só ativos de contabilidade, municípios do IBGE, sem empresário individual nem CPF', async () => {
    expect(await startRegistryIngestion(deps, admin)).toMatchObject({
      status: 'started',
      reference: '2026-09',
    });
    expect(await runQueued()).toEqual([expect.objectContaining({ status: 'succeeded' })]);

    const ingestion = await db.registryIngestion.findFirstOrThrow();
    expect(ingestion).toMatchObject({ status: 'SUCCEEDED', reference: '2026-09', error: null });
    expect(ingestion.stats).toMatchObject({
      kept: 31,
      skipped: 8,
      invalid: 0,
      unmatchedMunicipalities: 1,
      individualsRemoved: 1,
      removed: 0,
      total: 30,
      removalSkipped: false,
    });
    expect(await db.registryCompany.count()).toBe(30);

    const alfa = await db.registryCompany.findUniqueOrThrow({
      where: { cnpj: fakeCnpj('FK000001') },
    });
    expect(alfa).toMatchObject({
      cnpjRoot: 'FK000001',
      isHeadOffice: true,
      companyName: 'Escritório Contábil Alfa Ltda',
      legalNature: '2062',
      isIndividualEntrepreneur: false,
      cnaeMain: '6920601',
      municipalityCode: SOBRAL,
      cityName: 'Sobral',
      uf: 'CE',
      phone1: '+558836110001',
      email: 'contato@alfa-contabil.example',
      datasetReference: '2026-09',
    });
    // Filial em Fortaleza, com a razão social da matriz.
    expect(
      await db.registryCompany.findUniqueOrThrow({ where: { cnpj: fakeCnpj('FK000001', '0002') } }),
    ).toMatchObject({
      isHeadOffice: false,
      companyName: 'Escritório Contábil Alfa Ltda',
      municipalityCode: 2304400,
    });
    // Cidade sem correspondência no IBGE: fica com o nome da Receita.
    expect(
      await db.registryCompany.findUniqueOrThrow({ where: { cnpj: fakeCnpj('FK000904') } }),
    ).toMatchObject({ municipalityCode: null, cityName: 'CIDADE FICTICIA DO SERTAO' });
    // Fora do recorte: baixado, atividade secundária, padarias, empresário individual.
    for (const root of ['FK000901', 'FK000902', 'FK000950', 'FK000903']) {
      expect(await db.registryCompany.count({ where: { cnpjRoot: root } })).toBe(0);
    }
    // O CPF fictício da razão social não fica em lugar nenhum.
    const everything = JSON.stringify(await db.registryCompany.findMany());
    expect(everything).not.toContain('12345678909');

    expect(
      await db.auditLog.count({
        where: { action: { in: ['registry.ingest.start', 'registry.ingest.finish'] } },
      }),
    ).toBe(2);
    expect(
      await db.notification.findFirstOrThrow({ where: { type: 'registry.ingested' } }),
    ).toMatchObject({ userId: admin.id });

    // Mesmo mês de novo: nada a fazer (a não ser forçando).
    expect(await startRegistryIngestion(deps, admin)).toMatchObject({ status: 'up_to_date' });
    expect(enqueued).toHaveLength(0);
  });

  it('configuração: empresário individual e atividade secundária só quando liberados', async () => {
    await setSettings({ includeIndividualEntrepreneurs: true, includeSecondaryCnae: true });
    await startRegistryIngestion(deps, admin);
    await runQueued();
    expect(await db.registryCompany.count()).toBe(32);
    expect(
      await db.registryCompany.findUniqueOrThrow({ where: { cnpj: fakeCnpj('FK000903') } }),
    ).toMatchObject({
      companyName: 'Maria Ficticia de Sousa',
      isIndividualEntrepreneur: true,
      legalNature: '2135',
      nameSearch: 'maria ficticia de sousa',
    });
    expect(
      await db.registryCompany.findUniqueOrThrow({ where: { cnpj: fakeCnpj('FK000902') } }),
    ).toMatchObject({ cnaeMain: '4761003', cnaesSecondary: ['6920601'] });
  });

  it('conexão caída no meio: a fila tenta de novo e a carga retoma do arquivo onde parou', async () => {
    source = new FakeCompanyRegistrySource({ failOnceOn: 'Estabelecimentos1.zip' });
    deps.companyRegistry = source;
    await startRegistryIngestion(deps, admin);
    const job = enqueued.find((j) => j.name === 'registry.ingest')!;
    await expect(runRegistryIngestion(deps, job.data)).rejects.toBeInstanceOf(CompanyRegistryError);
    const interrupted = await db.registryIngestion.findFirstOrThrow();
    expect(interrupted).toMatchObject({ status: 'RUNNING', error: 'UNAVAILABLE' });
    expect(interrupted.progress).toEqual({ done: ['Estabelecimentos0.zip'] });

    source.opened.length = 0;
    expect(await runRegistryIngestion(deps, job.data)).toMatchObject({ status: 'succeeded' });
    expect(source.opened).toEqual(['Municipios.zip', 'Estabelecimentos1.zip', 'Empresas0.zip']);
    expect(await db.registryCompany.count()).toBe(30);
    expect((await db.registryIngestion.findFirstOrThrow()).stats).toMatchObject({ kept: 31 });
  });

  it('mês novo: atualiza o que continua e apaga o que saiu; queda grande demais não apaga nada', async () => {
    await startRegistryIngestion(deps, admin);
    await runQueued();
    // Um escritório da cópia atual que não está no mês novo (baixado depois).
    await db.registryCompany.create({
      data: {
        cnpj: fakeCnpj('FK000990'),
        cnpjRoot: 'FK000990',
        isHeadOffice: true,
        tradeName: 'Contabilidade Que Fechou',
        nameSearch: 'contabilidade que fechou',
        cnaeMain: '6920601',
        receitaMunicipalityCode: 1559,
        uf: 'CE',
        datasetReference: '2026-09',
        ingestedAt: clockTime,
      },
    });
    source.publish('2026-10');
    clockTime = new Date('2026-11-05T12:00:00Z');
    expect(await runRegistryCheck(deps)).toMatchObject({ status: 'started', reference: '2026-10' });
    await runQueued();
    const october = await db.registryIngestion.findFirstOrThrow({
      where: { reference: '2026-10' },
    });
    expect(october.stats).toMatchObject({ removed: 1, total: 30, removalSkipped: false });
    expect(await db.registryCompany.count({ where: { datasetReference: '2026-10' } })).toBe(30);

    // Cópia atual muito maior que o mês novo (publicação suspeita): nada é apagado.
    await db.registryCompany.createMany({
      data: Array.from({ length: 100 }, (_, i) => ({
        cnpj: fakeCnpj(`FK1${String(i).padStart(5, '0')}`),
        cnpjRoot: `FK1${String(i).padStart(5, '0')}`,
        isHeadOffice: true,
        nameSearch: `contabilidade ${i}`,
        cnaeMain: '6920601',
        receitaMunicipalityCode: 1559,
        uf: 'CE',
        datasetReference: '2026-10',
        ingestedAt: clockTime,
      })),
    });
    source.publish('2026-11');
    clockTime = new Date('2026-12-05T12:00:00Z');
    await runRegistryCheck(deps);
    await runQueued();
    const november = await db.registryIngestion.findFirstOrThrow({
      where: { reference: '2026-11' },
    });
    expect(november.stats).toMatchObject({ removed: 0, removalSkipped: true, total: 130 });
    expect(
      await db.notification.count({ where: { type: 'registry.suspicious', userId: admin.id } }),
    ).toBe(1);
  });

  it('falhas e situações: não publicado, arquivo corrompido, carga parada, desligada, sem permissão', async () => {
    // Mês ainda não publicado por completo: nada é aberto.
    const incomplete = new FakeCompanyRegistrySource();
    incomplete.listFiles = async () => {
      throw new CompanyRegistryError('Publicação incompleta.', 'NOT_PUBLISHED');
    };
    deps.companyRegistry = incomplete;
    expect(await startRegistryIngestion(deps, admin)).toMatchObject({ status: 'not_published' });
    expect(await db.registryIngestion.count()).toBe(0);

    // Arquivo corrompido: a carga falha e os ADMINs são avisados.
    const broken = new FakeCompanyRegistrySource();
    const originalOpen = broken.open.bind(broken);
    broken.open = (reference: string, file: RegistryFile) => {
      if (file.kind === 'COMPANIES') {
        return (async function* () {
          yield* [];
          throw new CompanyRegistryError('Empresas0.zip corrompido.', 'INVALID_FILE');
        })();
      }
      return originalOpen(reference, file);
    };
    deps.companyRegistry = broken;
    await startRegistryIngestion(deps, admin);
    expect(await runQueued()).toEqual([
      expect.objectContaining({ status: 'failed', code: 'INVALID_FILE' }),
    ]);
    expect(await db.registryIngestion.findFirstOrThrow()).toMatchObject({
      status: 'FAILED',
      error: 'INVALID_FILE',
    });
    expect(
      await db.notification.count({ where: { type: 'registry.failed', userId: admin.id } }),
    ).toBe(1);

    // Carga parada há mais de 72 h: é dada como falha e outra começa.
    deps.companyRegistry = source;
    const stuck = await db.registryIngestion.create({
      data: { provider: 'fake', reference: '2026-08', startedAt: new Date('2026-10-09T12:00:00Z') },
    });
    expect(await startRegistryIngestion(deps, admin)).toMatchObject({ status: 'started' });
    expect(await db.registryIngestion.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject(
      {
        status: 'FAILED',
        error: 'STALLED',
      },
    );
    // Recente: só retoma.
    expect(await startRegistryIngestion(deps, admin)).toMatchObject({ status: 'resumed' });

    const sdr = (await createActor('SDR')).actor;
    await expect(startRegistryIngestion(deps, sdr)).rejects.toBeInstanceOf(ForbiddenError);
    await setSettings({ monthlyIngestion: false });
    expect(await runRegistryCheck(deps)).toEqual({ status: 'disabled' });
    deps.companyRegistry = null;
    expect(await runRegistryCheck(deps)).toEqual({ status: 'disabled' });
    await expect(startRegistryIngestion(deps, admin)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
