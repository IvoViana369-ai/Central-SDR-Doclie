import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';

type UserActor = Extract<Actor, { kind: 'user' }>;
import { BusinessRuleError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import {
  anonymizeLead,
  createLead,
  getLeadContactability,
  getLeadScore,
  type CreateLeadInput,
} from '../leads';
import { DEFAULT_CONTACT_RULES, updateContactRules } from '../settings';
import { createTask } from '../tasks';
import {
  cancelAssistedMessage,
  classifyReply,
  confirmAssistedMessage,
  listLeadMessages,
  logOutboundMessage,
  prepareAssistedMessage,
  recordReply,
} from '.';

const { db, deps, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;
const BODY = 'Olá! Sou da Docline, posso apresentar nossa parceria para escritórios?';

describe('contato assistido e respostas (M13, M14, F5-08 a F5-10)', () => {
  let admin: UserActor;
  let sdr: UserActor;
  let sourceId: string;
  let phone = 7100;

  const make = (name: string, overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: `(88) 99812-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
    ...overrides,
  });
  const lead = (id: string) =>
    db.lead.findUniqueOrThrow({ where: { id }, include: { stage: true, lossReason: true } });
  const whatsapp = async (id: string) =>
    (await getLeadContactability(deps, sdr, { leadId: id })).channels.find(
      (c) => c.channel === 'WHATSAPP',
    )!;

  beforeEach(async () => {
    at('2026-10-13T12:00:00Z');
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
  });
  afterAll(() => closeTestDb());

  it('abrir no WhatsApp com o texto, confirmar o envio: primeiro contato e etapa', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Aroeira'));
    const prepared = await prepareAssistedMessage(deps, sdr, {
      leadId: id,
      channel: 'WHATSAPP',
      body: BODY,
      messageType: 'FIRST_CONTACT',
    });
    const cp = await db.contactPoint.findFirstOrThrow({ where: { leadId: id } });
    expect(cp.valueNormalized).toBe(`+558899812${phone}`);
    expect(prepared.link).toBe(
      `https://wa.me/${cp.valueNormalized.slice(1)}?text=${encodeURIComponent(BODY)}`,
    );
    expect(prepared.message).toMatchObject({ status: 'PENDING_CONFIRMATION', mode: 'ASSISTED' });
    // Sem confirmação, nada mudou no lead.
    expect(await lead(id)).toMatchObject({ firstContactAt: null, stage: { key: 'NEW' } });

    at('2026-10-13T12:05:00Z');
    const sent = await confirmAssistedMessage(deps, sdr, { messageId: prepared.message.id });
    expect(sent).toMatchObject({ status: 'SENT', isFirstContact: true, sentBy: { id: sdr.id } });
    expect(await lead(id)).toMatchObject({
      firstContactAt: new Date('2026-10-13T12:05:00Z'),
      lastContactAt: new Date('2026-10-13T12:05:00Z'),
      stage: { key: 'FIRST_CONTACT' },
    });
    await expect(
      confirmAssistedMessage(deps, sdr, { messageId: prepared.message.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await db.leadEvent.count({ where: { leadId: id, type: 'message.sent' } })).toBe(1);
  });

  it('gate: intervalo mínimo entre contatos (exceto para responder) e janela de horário', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Baobá'));
    const first = await prepareAssistedMessage(deps, sdr, {
      leadId: id,
      channel: 'WHATSAPP',
      body: BODY,
    });
    await confirmAssistedMessage(deps, sdr, { messageId: first.message.id });

    // No dia seguinte (menos de 48 h): bloqueado, com a hora de liberação.
    at('2026-10-14T13:00:00Z');
    const blocked = await whatsapp(id);
    expect(blocked).toMatchObject({
      allowed: false,
      availableAt: new Date('2026-10-15T12:00:00Z'),
    });
    expect(blocked.reasons[0]).toMatch(/^Último contato há menos de 48 h\./);
    await expect(
      prepareAssistedMessage(deps, sdr, { leadId: id, channel: 'WHATSAPP', body: 'Oi de novo' }),
    ).rejects.toThrow(/Último contato há menos de 48 h/);

    // O lead respondeu: pode responder na hora.
    await recordReply(deps, sdr, {
      leadId: id,
      channel: 'WHATSAPP',
      body: 'Qual o valor do certificado A1?',
      classification: 'QUESTION',
    });
    expect((await whatsapp(id)).allowed).toBe(true);

    // Fora da janela (terça 22:00 local): bloqueado até quarta 08:00.
    at('2026-10-15T01:00:00Z');
    expect(await whatsapp(id)).toMatchObject({
      allowed: false,
      availableAt: new Date('2026-10-15T11:00:00Z'),
    });
  });

  it('limite diário de primeiros contatos por SDR, configurado pelo ADMIN', async () => {
    await updateContactRules(deps, admin, { ...DEFAULT_CONTACT_RULES, maxFirstContactsPerDay: 1 });
    const a = (await createLead(deps, sdr, make('Escritório Caju'))).id;
    const b = (await createLead(deps, sdr, make('Escritório Dendê'))).id;
    const prepared = await prepareAssistedMessage(deps, sdr, {
      leadId: a,
      channel: 'WHATSAPP',
      body: BODY,
    });
    await confirmAssistedMessage(deps, sdr, { messageId: prepared.message.id });
    expect((await whatsapp(b)).reasons).toEqual([
      'Limite de 1 primeiros contatos por dia atingido. Retome amanhã.',
    ]);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'settings.contact_rules' },
    });
    expect(audit.changes).toEqual({ maxFirstContactsPerDay: [40, 1] });
  });

  it('"SAIR" é opt-out na hora: Lista Não Contatar, etapa de perda e WhatsApp bloqueado', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Embaúba'));
    const prepared = await prepareAssistedMessage(deps, sdr, {
      leadId: id,
      channel: 'WHATSAPP',
      body: BODY,
    });
    await confirmAssistedMessage(deps, sdr, { messageId: prepared.message.id });

    at('2026-10-13T14:00:00Z');
    const reply = await recordReply(deps, sdr, {
      leadId: id,
      channel: 'WHATSAPP',
      body: 'SAIR',
      // A regra de opt-out prevalece sobre a classificação escolhida.
      classification: 'INTERESTED',
    });
    expect(reply.optOut).toEqual({ level: 'CERTAIN', match: 'sair' });
    expect(reply.message).toMatchObject({
      classification: 'OPT_OUT',
      classificationSource: 'RULE',
    });
    expect(await lead(id)).toMatchObject({
      contactStatus: 'OPTED_OUT',
      stage: { key: 'NOT_INTERESTED' },
      lossReason: { key: 'ASKED_NOT_TO_BE_CONTACTED' },
      firstReplyAt: new Date('2026-10-13T14:00:00Z'),
    });
    // O lead (sem CNPJ) e o telefone entram na Lista Não Contatar.
    const entries = await db.suppressionEntry.findMany({
      where: { reason: 'OPT_OUT', revokedAt: null },
      orderBy: { type: 'asc' },
    });
    expect(entries.map((e) => [e.type, e.scope])).toEqual([
      ['PHONE', 'ALL_CHANNELS'],
      ['LEAD', 'ALL_CHANNELS'],
    ]);
    expect((await whatsapp(id)).allowed).toBe(false);
    await expect(
      classifyReply(deps, sdr, { messageId: reply.message.id, classification: 'INTERESTED' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('possível opt-out fica para a pessoa decidir; interesse leva a "Interessado" e pontua', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Figueira'));
    const reply = await recordReply(deps, sdr, {
      leadId: id,
      channel: 'WHATSAPP',
      body: 'Hoje vou sair mais cedo, me liga amanhã que tenho interesse',
    });
    expect(reply.optOut).toEqual({ level: 'POSSIBLE', match: 'sair' });
    expect(reply.message.classification).toBeNull();
    expect(await lead(id)).toMatchObject({
      contactStatus: 'CONTACTABLE',
      stage: { key: 'REPLIED' },
    });
    const pending = await db.task.findFirstOrThrow({ where: { leadId: id, status: 'OPEN' } });
    expect(pending).toMatchObject({ type: 'REPLY_NEEDED' });
    expect(pending.title).toMatch(/^Possível pedido de opt-out/);

    await classifyReply(deps, sdr, { messageId: reply.message.id, classification: 'INTERESTED' });
    expect(await lead(id)).toMatchObject({ stage: { key: 'INTERESTED' } });
    const open = await db.task.findMany({ where: { leadId: id, status: 'OPEN' } });
    expect(open.map((t) => [t.type, t.title])).toEqual([['MEETING', 'Propor reunião']]);
    // WhatsApp 20 + Já respondeu 20 + Mostrou interesse 30.
    expect(await getLeadScore(deps, sdr, { leadId: id })).toMatchObject({ score: 70, band: 'HOT' });
  });

  it('ausente: tarefa para retomar na data; contato errado: contato marcado e tarefa', async () => {
    const away = (await createLead(deps, sdr, make('Escritório Goiaba'))).id;
    await recordReply(deps, sdr, {
      leadId: away,
      channel: 'WHATSAPP',
      body: 'Estou de férias até o dia 20.',
      classification: 'OUT_OF_OFFICE',
      outOfOfficeUntil: '2026-10-20T03:00:00Z', // terça 20, 00:00 local
    });
    expect(
      await db.task.findFirstOrThrow({ where: { leadId: away, status: 'OPEN' } }),
    ).toMatchObject({ title: 'Retomar contato', dueAt: new Date('2026-10-20T11:00:00Z') });

    const wrong = (await createLead(deps, sdr, make('Escritório Hortelã'))).id;
    const cp = await db.contactPoint.findFirstOrThrow({ where: { leadId: wrong } });
    await recordReply(deps, sdr, {
      leadId: wrong,
      channel: 'WHATSAPP',
      body: 'Número errado, aqui é uma padaria.',
      contactPointId: cp.id,
      classification: 'WRONG_CONTACT',
    });
    expect((await db.contactPoint.findUniqueOrThrow({ where: { id: cp.id } })).status).toBe(
      'WRONG_PERSON',
    );
    expect(
      (await db.task.findFirstOrThrow({ where: { leadId: wrong, status: 'OPEN' } })).title,
    ).toBe('Procurar outro contato');
  });

  it('registro manual, cancelamento de pendência e anonimização apagam o que devem', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Ingá'));
    const pending = await prepareAssistedMessage(deps, sdr, {
      leadId: id,
      channel: 'WHATSAPP',
      body: BODY,
    });
    await cancelAssistedMessage(deps, sdr, { messageId: pending.message.id });
    await expect(
      logOutboundMessage(deps, sdr, {
        leadId: id,
        channel: 'WHATSAPP',
        sentAt: '2026-10-20T12:00:00Z',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await logOutboundMessage(deps, sdr, {
      leadId: id,
      channel: 'WHATSAPP',
      body: 'Mensagem enviada pelo celular na semana passada.',
      sentAt: '2026-10-08T15:00:00Z',
    });
    expect(await lead(id)).toMatchObject({
      firstContactAt: new Date('2026-10-08T15:00:00Z'),
      stage: { key: 'FIRST_CONTACT' },
    });
    // A pendência cancelada não aparece na lista.
    expect((await listLeadMessages(deps, sdr, { leadId: id })).map((m) => m.mode)).toEqual([
      'LOGGED',
    ]);

    // Texto livre que cita uma pessoa (fictícia): na tarefa e num aviso.
    await createTask(deps, sdr, {
      leadId: id,
      title: 'Ligar para a sócia Fulana Teste',
      description: 'Pediu retorno à tarde.',
      dueAt: '2026-10-20T13:00:00Z',
    });
    await db.notification.create({
      data: { userId: sdr.id, type: 'test', title: 'Escritório Ingá', body: 'Fulana', leadId: id },
    });

    await anonymizeLead(deps, admin, { leadId: id, reason: 'Pedido do titular (teste).' });
    const messages = await db.message.findMany({ where: { leadId: id } });
    expect(messages.every((m) => m.body === null)).toBe(true);
    const tasks = await db.task.findMany({ where: { leadId: id } });
    expect(tasks.map((t) => [t.title, t.description])).toEqual(
      tasks.map(() => ['Tarefa (conteúdo removido na anonimização)', null]),
    );
    expect(await db.notification.findFirstOrThrow({ where: { leadId: id } })).toMatchObject({
      title: 'Aviso sobre um lead anonimizado',
      body: null,
    });
    // A timeline (append-only) nunca recebeu o texto livre.
    const events = await db.leadEvent.findMany({ where: { leadId: id } });
    expect(JSON.stringify(events.map((e) => e.payload))).not.toContain('Fulana');
  });
});
