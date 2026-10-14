import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import {
  addLeadTag,
  bulkLeads,
  createLead,
  createTag,
  getLeadScore,
  removeContactPoint,
  updateLead,
  type CreateLeadInput,
} from '../leads';
import {
  activateScoringModel,
  addPriorityCity,
  createScoringDraft,
  discardScoringDraft,
  listPriorityCities,
  listScoringModels,
  removePriorityCity,
  runScoreRecomputeAll,
  runScoreRecomputeLeads,
  simulateScoringModel,
  updateScoringDraft,
} from '.';

const { db, deps, enqueued, createActor } = createTestDeps();
// Relógio que avança entre os passos (o histórico é ordenado pela hora do cálculo).
let clockTime = new Date('2026-10-13T12:00:00Z');
deps.clock = { now: () => clockTime };
const tick = () => {
  clockTime = new Date(clockTime.getTime() + 60_000);
};
const SOBRAL = 2312908;
const FORTALEZA = 2304400;

describe('lead scoring (M07)', () => {
  let admin: Actor;
  let manager: Actor;
  let sdr: Actor;
  let otherSdr: Actor;
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
  const lead = (id: string) => db.lead.findUniqueOrThrow({ where: { id } });

  beforeEach(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor;
    manager = (await createActor('MANAGER')).actor;
    sdr = (await createActor('SDR')).actor;
    otherSdr = (await createActor('SDR')).actor;
    enqueued.length = 0;
  });

  afterAll(() => closeTestDb());

  it('o cadastro já sai com score, faixa e explicação por critério (modelo v1)', async () => {
    const { id } = await createLead(
      deps,
      sdr,
      make('Alfa', {
        website: 'https://alfa-ficticio.example',
        contactPoints: [
          { type: 'PHONE', value: '(88) 99812-6001', isWhatsapp: true },
          { type: 'INSTAGRAM', value: '@alfa.ficticio' },
        ],
      }),
    );
    expect(await lead(id)).toMatchObject({ score: 45, scoreBand: 'WARM' });

    const explained = await getLeadScore(deps, sdr, { leadId: id });
    expect(explained).toMatchObject({
      score: 45,
      band: 'WARM',
      bandLabel: 'Morno',
      pending: false,
      model: { version: 1 },
    });
    expect(explained.breakdown.filter((b) => b.matched).map((b) => b.criterion)).toEqual([
      'has_whatsapp',
      'has_instagram',
      'has_website',
    ]);
    expect(explained.history).toEqual([
      expect.objectContaining({
        score: 45,
        band: 'WARM',
        previousScore: null,
        trigger: 'contact_state',
      }),
    ]);
    // O primeiro cálculo vai só para o histórico do score, não para a timeline.
    expect(await db.leadEvent.count({ where: { leadId: id, type: 'score.changed' } })).toBe(0);

    // Fora do escopo, o lead "não existe".
    await expect(getLeadScore(deps, otherSdr, { leadId: id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('recalcula quando um critério muda; histórico só quando score ou faixa mudam', async () => {
    const { id } = await createLead(
      deps,
      sdr,
      make('Beta', {
        contactPoints: [{ type: 'PHONE', value: '(88) 99812-6002', isWhatsapp: true }],
      }),
    );
    expect((await lead(id)).score).toBe(20);

    // Campo que não é critério: nada muda.
    tick();
    await updateLead(deps, sdr, { leadId: id, version: 1, description: 'Atende MEI.' });
    expect(await db.leadScoreHistory.count({ where: { leadId: id } })).toBe(1);

    // Cidade prioritária: o recálculo da cidade vai para o worker.
    tick();
    enqueued.length = 0;
    await addPriorityCity(deps, admin, { municipalityCode: SOBRAL, notes: 'Foco do trimestre.' });
    expect(enqueued.map((j) => [j.name, j.data])).toEqual([
      ['score.recompute-all', { trigger: 'priority_city.added', municipalityCode: SOBRAL }],
    ]);
    await runScoreRecomputeAll(deps, enqueued[0]!.data as { municipalityCode: number });
    expect(await lead(id)).toMatchObject({ score: 35, scoreBand: 'WARM' });
    expect(await listPriorityCities(deps, sdr, {})).toEqual([
      expect.objectContaining({ name: 'Sobral', uf: 'CE', activeLeads: 1 }),
    ]);

    // Mudou de cidade: deixa de ser prioritária, na mesma transação.
    tick();
    await updateLead(deps, sdr, { leadId: id, version: 2, municipalityCode: FORTALEZA });
    expect((await lead(id)).score).toBe(20);

    // Sem o WhatsApp, o score cai e a faixa vira Frio.
    tick();
    const phone = await db.contactPoint.findFirstOrThrow({ where: { leadId: id } });
    await removeContactPoint(deps, sdr, { leadId: id, contactPointId: phone.id });
    expect(await lead(id)).toMatchObject({ score: 0, scoreBand: 'COLD' });
    const history = await db.leadScoreHistory.findMany({
      where: { leadId: id },
      orderBy: { computedAt: 'asc' },
    });
    expect(history.map((h) => [h.previousScore, h.score])).toEqual([
      [null, 20],
      [20, 35],
      [35, 20],
      [20, 0],
    ]);
    // Na timeline, só as mudanças (o primeiro cálculo fica de fora).
    const events = await db.leadEvent.findMany({
      where: { leadId: id, type: 'score.changed' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(
      events.map((e) => [e.actorType, (e.payload as { to: { score: number } }).to.score]),
    ).toEqual([
      ['AUTOMATION', 35],
      ['AUTOMATION', 20],
      ['AUTOMATION', 0],
    ]);

    await removePriorityCity(deps, admin, { municipalityCode: SOBRAL });
    expect(await listPriorityCities(deps, sdr, {})).toEqual([]);
    await expect(
      removePriorityCity(deps, admin, { municipalityCode: SOBRAL }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      addPriorityCity(deps, manager, { municipalityCode: SOBRAL }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('modelo novo: rascunho validado, simulação, ativação e recálculo da base', async () => {
    const tag = await createTag(deps, manager, { name: 'Indicação' });
    const a = (
      await createLead(
        deps,
        sdr,
        make('Gama', {
          contactPoints: [{ type: 'PHONE', value: '(88) 99812-6003', isWhatsapp: true }],
        }),
      )
    ).id;
    const b = (await createLead(deps, sdr, make('Delta'))).id;
    await addLeadTag(deps, sdr, { leadId: b, tagId: tag.id });

    await expect(createScoringDraft(deps, manager, {})).rejects.toBeInstanceOf(ForbiddenError);
    const draft = await createScoringDraft(deps, admin, {});
    expect(draft).toMatchObject({ version: 2, status: 'DRAFT' });
    expect((await createScoringDraft(deps, admin, {})).id).toBe(draft.id);

    const base = {
      modelId: draft.id,
      name: 'Indicação pesa mais',
      normalization: 'CLAMP' as const,
      bands: draft.bands,
    };
    await expect(
      updateScoringDraft(deps, admin, {
        ...base,
        rules: [{ criterionKey: 'nao_existe', params: {}, points: 10 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateScoringDraft(deps, admin, {
        ...base,
        bands: [...draft.bands.slice(0, 3), { band: 'PRIORITY', min: 81, max: 99 }],
        rules: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await updateScoringDraft(deps, admin, {
      ...base,
      rules: [
        { criterionKey: 'has_whatsapp', params: {}, points: 20 },
        { criterionKey: 'has_tag', params: { tagId: tag.id }, points: 90 },
      ],
    });

    const simulation = await simulateScoringModel(deps, admin, { modelId: draft.id });
    expect(simulation).toMatchObject({ total: 2, bandChanges: 1 });
    expect(simulation.bands.find((x) => x.band === 'PRIORITY')).toMatchObject({
      current: 0,
      simulated: 1,
    });

    enqueued.length = 0;
    await activateScoringModel(deps, admin, { modelId: draft.id });
    expect(enqueued.map((j) => j.name)).toEqual(['score.recompute-all']);
    const { models } = await listScoringModels(deps, admin, {});
    expect(models.map((m) => [m.version, m.status])).toEqual([
      [2, 'ACTIVE'],
      [1, 'ARCHIVED'],
    ]);
    await expect(updateScoringDraft(deps, admin, { ...base, rules: [] })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );

    tick();
    await runScoreRecomputeAll(deps, { trigger: 'model.activated' });
    expect(await lead(a)).toMatchObject({ score: 20, scoreBand: 'COLD' });
    expect(await lead(b)).toMatchObject({ score: 90, scoreBand: 'PRIORITY' });
    const last = await db.leadScoreHistory.findFirstOrThrow({
      where: { leadId: b },
      orderBy: { computedAt: 'desc' },
    });
    expect(last).toMatchObject({ trigger: 'model.activated', previousScore: 0 });

    // Novo rascunho e descarte (nunca pontuou ninguém).
    const another = await createScoringDraft(deps, admin, {});
    expect(another.version).toBe(3);
    await discardScoringDraft(deps, admin, { modelId: another.id });
    expect(await db.scoringModel.count()).toBe(2);
  });

  it('ação em massa de tags recalcula no worker', async () => {
    const tag = await createTag(deps, manager, { name: 'Parceiro' });
    const ids = [
      (await createLead(deps, manager, make('Épsilon'))).id,
      (await createLead(deps, manager, make('Zeta'))).id,
    ];
    const target = { ids };
    const dry = await bulkLeads(deps, manager, {
      action: 'addTag',
      params: { tagId: tag.id },
      target,
      dryRun: true,
    });
    enqueued.length = 0;
    await bulkLeads(deps, manager, {
      action: 'addTag',
      params: { tagId: tag.id },
      target,
      dryRun: false,
      confirmationToken: dry.dryRun ? dry.confirmationToken : '',
    });
    expect(enqueued.map((j) => [j.name, (j.data as { leadIds: string[] }).leadIds.length])).toEqual(
      [['score.recompute-lead', 2]],
    );
    expect(await runScoreRecomputeLeads(deps, enqueued[0]!.data as { leadIds: string[] })).toEqual({
      computed: 2,
      changed: 0,
    });
  });
});
