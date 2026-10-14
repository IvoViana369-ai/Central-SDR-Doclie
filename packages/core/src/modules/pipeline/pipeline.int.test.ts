import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { createLead, type CreateLeadInput } from '../leads';
import {
  getPipeline,
  getPipelineBoard,
  listLeadStageHistory,
  listLossReasons,
  listStageCards,
  moveLeadStage,
  updatePipelineStages,
} from '.';

const { db, deps, createActor } = createTestDeps();
const SOBRAL = 2312908;
const DAY_MS = 86_400_000;

describe('pipeline (M08)', () => {
  let admin: Actor;
  let manager: Actor;
  let sdr: Actor;
  let otherSdr: Actor;
  let sourceId: string;
  let stages: Record<string, string>;

  const make = (name: string, overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [],
    acknowledgeDuplicates: true,
    ...overrides,
  });
  const create = async (actor: Actor, name: string, overrides: Partial<CreateLeadInput> = {}) =>
    (await createLead(deps, actor, make(name, overrides))).id;
  const version = async (leadId: string) =>
    (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).version;
  const move = async (
    actor: Actor,
    leadId: string,
    key: string,
    extra: { lossReasonId?: string; note?: string } = {},
  ) =>
    moveLeadStage(deps, actor, {
      leadId,
      stageId: stages[key]!,
      version: await version(leadId),
      ...extra,
    });
  const reason = async (key: string) =>
    (await db.lossReason.findUniqueOrThrow({ where: { key } })).id;

  beforeEach(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor;
    manager = (await createActor('MANAGER')).actor;
    sdr = (await createActor('SDR')).actor;
    otherSdr = (await createActor('SDR')).actor;
    stages = Object.fromEntries(
      (await db.pipelineStage.findMany()).map((s) => [s.key, s.id] as const),
    );
  });

  afterAll(() => closeTestDb());

  it('todo cadastro entra em "Novo", com a primeira passagem no histórico', async () => {
    const id = await create(sdr, 'Alfa');
    const lead = await db.lead.findUniqueOrThrow({
      where: { id },
      include: { stage: true, stageHistory: true },
    });
    expect(lead.stage?.key).toBe('NEW');
    expect(lead.stageEnteredAt).toEqual(deps.clock.now());
    expect(lead.stageHistory).toEqual([
      expect.objectContaining({ fromStageId: null, leftAt: null, automationSource: null }),
    ]);
  });

  it('mover: histórico com duração, timeline, auditoria e lock otimista', async () => {
    const id = await create(sdr, 'Beta');
    // Entrou em "Novo" dois dias antes.
    const twoDaysAgo = new Date(deps.clock.now().getTime() - 2 * DAY_MS);
    await db.leadStageHistory.updateMany({
      where: { leadId: id },
      data: { enteredAt: twoDaysAgo },
    });

    const result = await move(sdr, id, 'TO_QUALIFY', { note: 'Conferir site.' });
    expect(result).toMatchObject({ stageKey: 'TO_QUALIFY', version: 2, optedOut: false });

    const history = await listLeadStageHistory(deps, sdr, { leadId: id });
    expect(history.map((h) => [h.from?.key ?? null, h.to.key, h.current])).toEqual([
      ['NEW', 'TO_QUALIFY', true],
      [null, 'NEW', false],
    ]);
    expect(history[1]!.durationSeconds).toBe(2 * 86_400);
    expect(history[0]).toMatchObject({ note: 'Conferir site.', changedByName: expect.any(String) });

    const event = await db.leadEvent.findFirstOrThrow({
      where: { leadId: id, type: 'stage.changed' },
    });
    expect(event.payload).toMatchObject({
      from: { key: 'NEW' },
      to: { key: 'TO_QUALIFY' },
      durationSeconds: 2 * 86_400,
    });
    expect(await db.auditLog.count({ where: { action: 'lead.stage_change', entityId: id } })).toBe(
      1,
    );

    // Versão antiga (outra aba): recusado, nada muda.
    await expect(
      moveLeadStage(deps, sdr, { leadId: id, stageId: stages.QUALIFIED!, version: 1 }),
    ).rejects.toThrow(/está em "A qualificar"/);
    await expect(
      moveLeadStage(deps, sdr, { leadId: id, stageId: stages.QUALIFIED!, version: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('regras: automação, conversão e reabertura são do gestor; primeiro contato, de ninguém', async () => {
    const id = await create(sdr, 'Gama');
    await expect(move(sdr, id, 'FIRST_CONTACT')).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(move(manager, id, 'FIRST_CONTACT')).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(move(sdr, id, 'FOLLOW_UP_1')).rejects.toThrow(/cadência/);
    await expect(move(sdr, id, 'CONVERTED')).rejects.toBeInstanceOf(BusinessRuleError);

    await move(manager, id, 'CONVERTED', { note: 'Fechou parceria (registro manual).' });
    let lead = await db.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.convertedAt).toEqual(deps.clock.now());
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lead.stage_change' } });
    expect(audit.metadata).toMatchObject({ override: true, to: 'CONVERTED' });

    // Reabrir limpa o desfecho; o SDR não reabre.
    await expect(move(sdr, id, 'NEGOTIATION')).rejects.toBeInstanceOf(BusinessRuleError);
    await move(manager, id, 'NEGOTIATION');
    lead = await db.lead.findUniqueOrThrow({ where: { id } });
    expect(lead.convertedAt).toBeNull();
  });

  it('perda exige motivo; "pediu para não ser contatado" entra na Lista Não Contatar', async () => {
    const id = await create(sdr, 'Delta', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99812-4001', isWhatsapp: true }],
    });
    await expect(move(sdr, id, 'NOT_INTERESTED')).rejects.toBeInstanceOf(ValidationError);
    const reasons = await listLossReasons(deps, sdr, { stageKey: 'NOT_INTERESTED' });
    expect(reasons.map((r) => r.name)).toContain('Pediu para não ser contatado');

    const result = await move(sdr, id, 'NOT_INTERESTED', {
      lossReasonId: await reason('ASKED_NOT_TO_BE_CONTACTED'),
    });
    expect(result.optedOut).toBe(true);
    const lead = await db.lead.findUniqueOrThrow({ where: { id }, include: { lossReason: true } });
    expect(lead).toMatchObject({ contactStatus: 'OPTED_OUT', lostAt: deps.clock.now() });
    expect(lead.lossReason?.key).toBe('ASKED_NOT_TO_BE_CONTACTED');
    expect(await db.suppressionEntry.count({ where: { type: 'PHONE' } })).toBe(1);
  });

  it('arquivado não muda de etapa; fora do escopo o lead "não existe"', async () => {
    const id = await create(sdr, 'Épsilon');
    await expect(move(otherSdr, id, 'TO_QUALIFY')).rejects.toBeInstanceOf(NotFoundError);
    await db.lead.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await expect(move(sdr, id, 'TO_QUALIFY')).rejects.toThrow(/Reative o lead/);
  });

  it('quadro: contagens, prioridade por score, filtros, escopo e paginação por coluna', async () => {
    const a = await create(sdr, 'Zeta Baixo');
    const b = await create(sdr, 'Eta Alto');
    const c = await create(sdr, 'Teta Sem Score');
    await create(otherSdr, 'Iota de Outro SDR');
    await db.lead.update({ where: { id: a }, data: { score: 20, scoreBand: 'COLD' } });
    await db.lead.update({ where: { id: b }, data: { score: 85, scoreBand: 'PRIORITY' } });
    await move(sdr, c, 'QUALIFIED');

    const board = await getPipelineBoard(deps, sdr, {});
    const column = (key: string) => board.columns.find((col) => col.stage.key === key)!;
    expect(board.columns).toHaveLength(17);
    expect(board.total).toBe(3); // o lead do outro SDR está fora do escopo
    expect(column('NEW').cards.map((card) => card.displayName)).toEqual(['Eta Alto', 'Zeta Baixo']);
    expect(column('NEW').cards[0]).toMatchObject({
      score: 85,
      scoreBand: 'PRIORITY',
      daysInStage: 0,
    });
    expect(column('QUALIFIED').count).toBe(1);

    const managerBoard = await getPipelineBoard(deps, manager, {
      filter: { field: 'scoreBand', op: 'eq', value: 'PRIORITY' },
    });
    expect(managerBoard.total).toBe(1);

    const first = await getPipelineBoard(deps, manager, { perColumn: 1 });
    const news = first.columns.find((col) => col.stage.key === 'NEW')!;
    expect(news).toMatchObject({ count: 3, nextCursor: 1 });
    const more = await listStageCards(deps, manager, { stageId: stages.NEW!, cursor: 1, limit: 5 });
    expect(more.cards).toHaveLength(2);
    expect(more.nextCursor).toBeNull();
  });

  it('etapas: ADMIN renomeia, reordena e cria; nada é excluído; etapa com leads não é desativada', async () => {
    const config = await getPipeline(deps, admin, {});
    const list = config.stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color as 'slate',
      slaHours: s.slaHours,
      active: s.active,
    }));
    await expect(updatePipelineStages(deps, manager, { stages: list })).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    // Renomear "Novo", mover "Qualificado" para o topo e criar uma etapa de perda.
    const renamed = list.map((s) =>
      s.name === 'Novo' ? { ...s, name: 'Entrada', slaHours: 48 } : s,
    );
    const qualified = renamed.find((s) => s.name === 'Qualificado')!;
    const reordered = [
      qualified,
      ...renamed.filter((s) => s !== qualified),
      { name: 'Perdido por prazo', color: 'red' as const, active: true, category: 'LOST' as const },
    ];
    await updatePipelineStages(deps, admin, { stages: reordered });
    const after = await getPipeline(deps, admin, {});
    expect(after.stages[0]!.key).toBe('QUALIFIED');
    expect(after.stages.find((s) => s.key === 'NEW')).toMatchObject({
      name: 'Entrada',
      slaHours: 48,
    });
    expect(after.stages.at(-1)).toMatchObject({
      key: 'PERDIDO_POR_PRAZO',
      category: 'LOST',
      requiresLossReason: true,
      isSystem: false,
    });
    expect(await db.auditLog.count({ where: { action: 'pipeline.stages_update' } })).toBe(1);

    // Sumir da lista = excluir: recusado. Etapa do sistema não se desativa.
    await expect(
      updatePipelineStages(deps, admin, { stages: reordered.slice(1) }),
    ).rejects.toBeInstanceOf(ValidationError);
    const current = (await getPipeline(deps, admin, {})).stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color as 'slate',
      active: s.key === 'NEW' ? false : s.active,
    }));
    await expect(updatePipelineStages(deps, admin, { stages: current })).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: expect.stringMatching(/etapa do sistema/) })],
    });

    // Etapa criada com um lead dentro: só desativa depois de mover os leads.
    const custom = after.stages.at(-1)!;
    stages.PERDIDO_POR_PRAZO = custom.id;
    const id = await create(admin, 'Kapa');
    await move(admin, id, 'PERDIDO_POR_PRAZO', { lossReasonId: await reason('OTHER') });
    const deactivate = (await getPipeline(deps, admin, {})).stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color as 'slate',
      active: s.id === custom.id ? false : s.active,
    }));
    await expect(updatePipelineStages(deps, admin, { stages: deactivate })).rejects.toThrow(
      /Mova os leads/,
    );
  });
});
