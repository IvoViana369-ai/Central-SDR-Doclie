import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { BusinessRuleError, ConflictError, ValidationError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { createLead, registerOptOut, type CreateLeadInput } from '../leads';
import { confirmAssistedMessage, prepareAssistedMessage, recordReply } from '../messaging';
import { moveLeadStage } from '../pipeline';
import { completeTask, rescheduleTask } from '../tasks';
import {
  createCadence,
  enrollLead,
  getLeadCadence,
  listCadences,
  pauseCadence,
  runCadenceTick,
  setDefaultCadence,
  skipCadenceStep,
  updateCadence,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça 13/10, 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;

describe('cadência (M11; suíte de cadência)', () => {
  let admin: UserActor;
  let manager: UserActor;
  let sdr: UserActor;
  let sourceId: string;
  let phone = 7300;

  const make = (name: string): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: `(88) 99812-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  const lead = (id: string) =>
    db.lead.findUniqueOrThrow({ where: { id }, include: { stage: true } });
  const openTask = (leadId: string) =>
    db.task.findFirstOrThrow({ where: { leadId, status: 'OPEN' } });
  const enrollment = (leadId: string) =>
    db.cadenceEnrollment.findFirstOrThrow({ where: { leadId }, orderBy: { enrolledAt: 'desc' } });
  /** Envia pelo contato assistido e confirma (o envio cumpre o passo vencido). */
  const sendStep = async (leadId: string) => {
    const prepared = await prepareAssistedMessage(deps, sdr, {
      leadId,
      channel: 'WHATSAPP',
      body: 'Mensagem do passo (teste).',
    });
    return confirmAssistedMessage(deps, sdr, { messageId: prepared.message.id });
  };

  beforeEach(async () => {
    at('2026-10-13T12:00:00Z');
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
  });
  afterAll(() => closeTestDb());

  it('D0 → D2 → D5 → D10 → "Sem resposta": tarefas, etapas e datas em dias úteis', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Jacarandá'));
    const enrolled = await enrollLead(deps, sdr, { leadId: id });
    expect(enrolled.plan.steps.map((s) => s.dueAt.toISOString())).toEqual([
      '2026-10-13T12:00:00.000Z', // D0: agora
      '2026-10-15T11:00:00.000Z', // D2: quinta 08:00
      '2026-10-20T11:00:00.000Z', // D5: terça 20 08:00
      '2026-10-27T11:00:00.000Z', // D10: terça 27 08:00
    ]);
    expect(await lead(id)).toMatchObject({ stage: { key: 'AWAITING_OUTREACH' } });
    expect(await openTask(id)).toMatchObject({
      type: 'FIRST_CONTACT',
      title: 'Primeiro contato — Padrão — Contabilidade',
      assigneeId: sdr.id,
      dueAt: new Date('2026-10-13T12:00:00Z'),
    });
    await expect(enrollLead(deps, sdr, { leadId: id })).rejects.toBeInstanceOf(ConflictError);

    // D0: primeiro contato confirmado → "Primeiro contato"; D2 agendado.
    await sendStep(id);
    expect(await lead(id)).toMatchObject({ stage: { key: 'FIRST_CONTACT' } });
    expect(await openTask(id)).toMatchObject({
      title: 'Follow-up 1 — Padrão — Contabilidade',
      dueAt: new Date('2026-10-15T11:00:00Z'),
    });

    // D2 feito com atraso (sexta 16, 10:00): o D5 conta da execução real.
    at('2026-10-16T13:00:00Z');
    await sendStep(id);
    expect(await lead(id)).toMatchObject({ stage: { key: 'FOLLOW_UP_1' } });
    expect((await openTask(id)).dueAt).toEqual(new Date('2026-10-21T11:00:00Z'));

    at('2026-10-21T13:00:00Z');
    await sendStep(id);
    expect(await lead(id)).toMatchObject({ stage: { key: 'FOLLOW_UP_2' } });
    expect((await openTask(id)).dueAt).toEqual(new Date('2026-10-28T11:00:00Z'));

    // D10 concluído pela tarefa (contato feito por outro meio).
    at('2026-10-28T13:00:00Z');
    await completeTask(deps, sdr, {
      taskId: (await openTask(id)).id,
      outcome: 'Mensagem de voz enviada.',
    });
    expect(await lead(id)).toMatchObject({ stage: { key: 'FOLLOW_UP_3' } });
    expect(await enrollment(id)).toMatchObject({
      status: 'ACTIVE',
      currentStepPosition: null,
      // +3 dias úteis: qui 29, sex 30 e (segunda 02/11 é Finados) terça 03/11, 08:00.
      nextStepDueAt: new Date('2026-11-03T11:00:00Z'),
    });

    // Antes do prazo, o tick não mexe; depois, "Sem resposta".
    at('2026-10-30T13:00:00Z');
    expect(await runCadenceTick(deps)).toMatchObject({ completed: 0 });
    at('2026-11-05T13:00:00Z');
    expect(await runCadenceTick(deps)).toMatchObject({ completed: 1, failed: 0 });
    expect(await lead(id)).toMatchObject({ stage: { key: 'NO_RESPONSE' } });
    expect(await enrollment(id)).toMatchObject({ status: 'COMPLETED' });
    expect(await db.leadEvent.count({ where: { leadId: id, type: 'cadence.completed' } })).toBe(1);
  });

  it('parada automática: resposta, opt-out e mudança manual para fora da cadência', async () => {
    const replied = (await createLead(deps, sdr, make('Escritório Kiwi'))).id;
    await enrollLead(deps, sdr, { leadId: replied });
    await sendStep(replied);
    await recordReply(deps, sdr, {
      leadId: replied,
      channel: 'WHATSAPP',
      body: 'Pode me mandar a proposta?',
      classification: 'QUESTION',
    });
    expect(await enrollment(replied)).toMatchObject({ status: 'STOPPED', stopReason: 'REPLIED' });
    expect(await lead(replied)).toMatchObject({ stage: { key: 'REPLIED' } });
    // A tarefa do passo foi cancelada; sobrou a de responder.
    const tasks = await db.task.findMany({ where: { leadId: replied, status: 'OPEN' } });
    expect(tasks.map((t) => t.type)).toEqual(['REPLY_NEEDED']);

    const optedOut = (await createLead(deps, sdr, make('Escritório Limoeiro'))).id;
    await enrollLead(deps, sdr, { leadId: optedOut });
    await registerOptOut(deps, sdr, { leadId: optedOut, scope: 'ALL_CHANNELS', reason: 'OPT_OUT' });
    expect(await enrollment(optedOut)).toMatchObject({
      status: 'STOPPED',
      stopReason: 'OPTED_OUT',
    });
    expect(await db.task.count({ where: { leadId: optedOut, status: 'OPEN' } })).toBe(0);
    await expect(enrollLead(deps, sdr, { leadId: optedOut })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );

    const moved = (await createLead(deps, sdr, make('Escritório Mangaba'))).id;
    await enrollLead(deps, sdr, { leadId: moved });
    const stage = (key: string) => db.pipelineStage.findFirstOrThrow({ where: { key } });
    // Voltar para "Qualificado" (antes do primeiro contato) não encerra.
    await moveLeadStage(deps, sdr, {
      leadId: moved,
      stageId: (await stage('QUALIFIED')).id,
      version: (await lead(moved)).version,
    });
    expect(await enrollment(moved)).toMatchObject({ status: 'ACTIVE' });
    await moveLeadStage(deps, manager, {
      leadId: moved,
      stageId: (await stage('MEETING')).id,
      version: (await lead(moved)).version,
    });
    expect(await enrollment(moved)).toMatchObject({
      status: 'STOPPED',
      stopReason: 'STAGE_CHANGED',
    });
  });

  it('pausar até uma data, retomar pelo tick; pular passo; reparar tarefa perdida', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Nogueira'));
    await enrollLead(deps, sdr, { leadId: id });
    await pauseCadence(deps, sdr, { leadId: id, until: '2026-10-19T12:00:00Z' });
    expect(await enrollment(id)).toMatchObject({ status: 'PAUSED' });
    expect(await db.task.count({ where: { leadId: id, status: 'OPEN' } })).toBe(0);

    at('2026-10-19T13:00:00Z');
    expect(await runCadenceTick(deps)).toMatchObject({ resumed: 1 });
    expect(await enrollment(id)).toMatchObject({ status: 'ACTIVE', currentStepPosition: 1 });
    expect((await openTask(id)).dueAt).toEqual(new Date('2026-10-19T13:00:00Z'));

    await skipCadenceStep(deps, sdr, { taskId: (await openTask(id)).id, reason: 'Sem WhatsApp.' });
    expect(await enrollment(id)).toMatchObject({ currentStepPosition: 2 });
    // Pular não conta como contato: a etapa não muda.
    expect(await lead(id)).toMatchObject({ stage: { key: 'AWAITING_OUTREACH' } });

    // Tarefa do passo perdida (ex.: apagada por engano): o tick recria.
    await db.task.updateMany({
      where: { leadId: id, status: 'OPEN' },
      data: { status: 'CANCELED' },
    });
    expect(await runCadenceTick(deps)).toMatchObject({ repaired: 1 });
    expect(await db.task.count({ where: { leadId: id, status: 'OPEN' } })).toBe(1);

    // Reagendar o passo leva a inscrição junto.
    await rescheduleTask(deps, sdr, {
      taskId: (await openTask(id)).id,
      dueAt: '2026-10-27T14:00:00Z',
    });
    expect(await enrollment(id)).toMatchObject({
      nextStepDueAt: new Date('2026-10-27T14:00:00Z'),
    });

    const view = await getLeadCadence(deps, sdr, { leadId: id });
    expect(view[0]).toMatchObject({ statusLabel: 'Ativa', currentStepPosition: 2 });
    expect(view[0]!.steps.map((s) => s.done)).toEqual([true, false, false, false]);
  });

  it('configuração pelo ADMIN: validação, versão, padrão', async () => {
    const [standard] = await listCadences(deps, sdr, {});
    const base = {
      name: 'Reativação 90 dias',
      sendWindowStart: '09:00',
      sendWindowEnd: '17:00',
      noResponseAfterDays: 5,
      steps: [
        { dayOffset: 0, messageType: 'REACTIVATION' as const, targetStageKey: 'FIRST_CONTACT' },
        { dayOffset: 3, messageType: 'FOLLOW_UP_1' as const, targetStageKey: 'FOLLOW_UP_1' },
      ],
    };
    await expect(
      createCadence(deps, admin, {
        ...base,
        steps: [
          { dayOffset: 2, messageType: 'FIRST_CONTACT' },
          { dayOffset: 1, messageType: 'FOLLOW_UP_1', targetStageKey: 'DISCARDED' },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const created = await createCadence(deps, admin, base);
    expect(created).toMatchObject({ key: 'REATIVACAO_90_DIAS', version: 1, isDefault: false });

    const updated = await updateCadence(deps, admin, {
      ...base,
      cadenceId: created.id,
      noResponseAfterDays: 7,
    });
    expect(updated.version).toBe(2);
    await expect(
      updateCadence(deps, admin, {
        ...base,
        name: standard!.name,
        cadenceId: standard!.id,
        active: false,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    await setDefaultCadence(deps, admin, { cadenceId: created.id });
    expect((await listCadences(deps, sdr, {}))[0]).toMatchObject({
      id: created.id,
      isDefault: true,
    });
  });
});
