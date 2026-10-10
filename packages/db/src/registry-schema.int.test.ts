import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

const db = getTestDb();
const now = new Date('2026-10-13T12:00:00Z');
const SOBRAL = 2312908;

/** Estabelecimento fictício da base aberta (CNPJ inventado, sem pessoa física). */
function company(cnpj: string, overrides: Record<string, unknown> = {}) {
  return {
    cnpj,
    cnpjRoot: cnpj.slice(0, 8),
    isHeadOffice: cnpj.slice(8, 12) === '0001',
    companyName: 'Contabilidade Fictícia Ltda',
    tradeName: 'Contábil Fictícia',
    nameSearch: 'contabil ficticia',
    cnaeMain: '6920601',
    municipalityCode: SOBRAL,
    receitaMunicipalityCode: 1559,
    cityName: 'SOBRAL',
    uf: 'CE',
    datasetReference: '2026-09',
    ingestedAt: now,
    ...overrides,
  };
}

describe('schema da base aberta do CNPJ e da Prospecção (garantias no banco)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('uma carga de cada vez; terminada, outra pode começar', async () => {
    const first = await db.registryIngestion.create({
      data: { provider: 'fake', reference: '2026-09', startedAt: now },
    });
    await expect(
      db.registryIngestion.create({
        data: { provider: 'fake', reference: '2026-09', startedAt: now },
      }),
    ).rejects.toThrow();
    await db.registryIngestion.update({
      where: { id: first.id },
      data: { status: 'SUCCEEDED', finishedAt: now },
    });
    await db.registryIngestion.create({
      data: { provider: 'fake', reference: '2026-10', startedAt: now },
    });
    expect(await db.registryIngestion.count({ where: { status: 'RUNNING' } })).toBe(1);
  });

  it('estabelecimento único por CNPJ (inclusive alfanumérico) e ligado ao município do IBGE', async () => {
    await db.registryCompany.create({ data: company('12345678000195') });
    await expect(db.registryCompany.create({ data: company('12345678000195') })).rejects.toThrow();
    // CNPJ alfanumérico (a partir de julho de 2026).
    await db.registryCompany.create({
      data: company('12ABC34501DE35', { cnpjRoot: '12ABC345', isHeadOffice: false }),
    });
    const withCity = await db.registryCompany.findUniqueOrThrow({
      where: { cnpj: '12345678000195' },
      select: { municipality: { select: { name: true } } },
    });
    expect(withCity.municipality?.name).toBe('Sobral');
    // Município da Receita sem correspondência no IBGE: fica sem o código.
    await db.registryCompany.create({
      data: company('98765432000110', { municipalityCode: null, cityName: 'CIDADE FICTICIA' }),
    });
    expect(await db.registryCompany.count({ where: { municipalityCode: null } })).toBe(1);
  });

  it('um resultado por CNPJ em cada busca; some com a busca; lead apagado não apaga o resultado', async () => {
    const source = await db.leadSource.findUniqueOrThrow({ where: { key: 'CNPJ_OPEN_DATA' } });
    const lead = await db.lead.create({
      data: {
        displayName: 'Contábil Fictícia',
        nameSearch: 'contabil ficticia',
        nameCore: 'contabil ficticia',
        originSourceId: source.id,
        collectedAt: now,
        createdVia: 'PROSPECTING',
        isTestData: true,
      },
    });
    const search = await db.prospectingSearch.create({
      data: { provider: 'CNPJ_OPEN_DATA', params: { uf: 'CE' }, resultCount: 1 },
    });
    const result = {
      searchId: search.id,
      providerRef: '12345678000195',
      matchStatus: 'NEW' as const,
    };
    await db.prospectingResult.create({ data: { ...result, createdLeadId: lead.id } });
    await expect(db.prospectingResult.create({ data: result })).rejects.toThrow();

    await db.lead.delete({ where: { id: lead.id } });
    expect(
      await db.prospectingResult.findFirstOrThrow({ where: { searchId: search.id } }),
    ).toMatchObject({ createdLeadId: null, decision: 'PENDING' });

    await db.prospectingSearch.delete({ where: { id: search.id } });
    expect(await db.prospectingResult.count()).toBe(0);
  });
});
