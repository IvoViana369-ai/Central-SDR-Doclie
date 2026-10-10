import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';

type UserActor = Extract<Actor, { kind: 'user' }>;
import { BusinessRuleError, ForbiddenError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { archiveLead, createLead, type CreateLeadInput } from '../leads';
import {
  cancelTask,
  completeTask,
  createTask,
  listLeadTasks,
  logActivity,
  rescheduleTask,
} from '.';

const { db, deps, createActor } = createTestDeps();
const now = new Date('2026-10-13T12:00:00Z'); // terça 09:00 em Fortaleza
const SOBRAL = 2312908;

describe('tarefas e atividades (F5-01, F5-02)', () => {
  let manager: UserActor;
  let sdr: UserActor;
  let otherSdr: UserActor;
  let sourceId: string;

  const make = (name: string): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: '(88) 99812-7001', isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });
  const lead = (id: string) =>
    db.lead.findUniqueOrThrow({ where: { id }, include: { stage: true } });

  beforeEach(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
    otherSdr = (await createActor('SDR')).actor as UserActor;
  });
  afterAll(() => closeTestDb());

  it('follow-up avulso: criar, reagendar, concluir com resultado; próxima ação no lead', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Ipê'));
    const due = new Date('2026-10-14T13:00:00Z');
    const task = await createTask(deps, sdr, {
      leadId: id,
      title: 'Ligar para o contador',
      dueAt: due.toISOString(),
    });
    expect(task).toMatchObject({ type: 'FOLLOW_UP', status: 'OPEN', assignee: { id: sdr.id } });
    expect((await lead(id)).nextActionAt).toEqual(due);

    const later = new Date('2026-10-16T13:00:00Z');
    await rescheduleTask(deps, sdr, { taskId: task.id, dueAt: later.toISOString() });
    expect((await lead(id)).nextActionAt).toEqual(later);

    await completeTask(deps, sdr, { taskId: task.id, outcome: 'Pediu retorno em novembro.' });
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: 'DONE',
      outcome: 'Pediu retorno em novembro.',
      completedById: sdr.id,
    });
    expect((await lead(id)).nextActionAt).toBeNull();
    await expect(completeTask(deps, sdr, { taskId: task.id })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    const events = await db.leadEvent.findMany({
      where: { leadId: id, type: { in: ['task.created', 'task.completed'] } },
    });
    expect(events).toHaveLength(2);
  });

  it('só gestor e ADMIN criam tarefa para outra pessoa', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Jatobá'));
    await expect(
      createTask(deps, sdr, {
        leadId: id,
        title: 'Visitar',
        dueAt: now.toISOString(),
        assigneeId: otherSdr.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const task = await createTask(deps, manager, {
      leadId: id,
      type: 'MEETING',
      title: 'Reunião de apresentação',
      dueAt: now.toISOString(),
      assigneeId: sdr.id,
    });
    expect(task.assignee?.id).toBe(sdr.id);
    const listed = await listLeadTasks(deps, sdr, { leadId: id });
    expect(listed.open).toEqual([
      expect.objectContaining({ id: task.id, typeLabel: 'Reunião', overdue: false }),
    ]);
    await cancelTask(deps, manager, { taskId: task.id, reason: 'Cliente desmarcou.' });
    expect((await listLeadTasks(deps, sdr, { leadId: id })).open).toEqual([]);
  });

  it('ligação atendida conta como primeiro contato e conclui a tarefa; não atendida, não', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Cedro'));
    const task = await createTask(deps, sdr, {
      leadId: id,
      type: 'CALL',
      title: 'Ligar',
      dueAt: now.toISOString(),
    });
    await logActivity(deps, sdr, { leadId: id, type: 'CALL', outcome: 'NO_ANSWER' });
    expect(await lead(id)).toMatchObject({ firstContactAt: null, stage: { key: 'NEW' } });

    const answered = new Date('2026-10-13T11:40:00Z');
    await logActivity(deps, sdr, {
      leadId: id,
      type: 'CALL',
      outcome: 'CONNECTED',
      occurredAt: answered.toISOString(),
      durationMinutes: 6,
      notes: 'Conversou com a sócia; pediu proposta por WhatsApp.',
      taskId: task.id,
    });
    expect(await lead(id)).toMatchObject({
      firstContactAt: answered,
      lastContactAt: answered,
      stage: { key: 'FIRST_CONTACT' },
    });
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: 'DONE',
      outcome: 'Ligação: Atendeu',
    });
    expect(await db.activity.count({ where: { leadId: id } })).toBe(2);
    await expect(
      logActivity(deps, sdr, {
        leadId: id,
        type: 'VISIT',
        occurredAt: new Date('2026-10-20T12:00:00Z').toISOString(),
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('arquivar o lead cancela as tarefas abertas', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Dália'));
    await createTask(deps, sdr, { leadId: id, title: 'Retornar', dueAt: now.toISOString() });
    await archiveLead(deps, sdr, { leadId: id });
    expect(await db.task.findFirstOrThrow({ where: { leadId: id } })).toMatchObject({
      status: 'CANCELED',
      outcome: 'Lead arquivado.',
    });
    expect((await lead(id)).nextActionAt).toBeNull();
  });
});
