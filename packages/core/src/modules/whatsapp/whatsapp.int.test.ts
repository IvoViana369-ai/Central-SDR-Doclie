import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { BusinessRuleError, ForbiddenError, ValidationError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { createLead, getLeadContactability, registerOptOut, type CreateLeadInput } from '../leads';
import { DEFAULT_CONTACT_RULES, updateContactRules } from '../settings';
import {
  analyzeTemplate,
  FAKE_TEMPLATES,
  recordWhatsappOptIn,
  retryWhatsappMessage,
  revokeWhatsappOptIn,
  runWhatsappSend,
  sendWhatsappMessage,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, enqueued, whatsapp: fake, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;

async function expectError<T extends Error>(
  promise: Promise<unknown>,
  type: new (...args: never[]) => T,
): Promise<T> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    return error as T;
  }
  throw new Error(`esperava ${type.name}`);
}

/** Modelo aprovado como a sincronização gravaria (dados do provedor simulado). */
async function approvedTemplate(index = 0, extra: Record<string, unknown> = {}) {
  const info = FAKE_TEMPLATES[index]!;
  const analysis = analyzeTemplate(info.category, info.components);
  return db.whatsappTemplate.create({
    data: {
      metaTemplateId: info.metaTemplateId,
      name: info.name,
      language: info.language,
      category: info.category,
      status: info.status,
      parameterFormat: info.parameterFormat,
      components: info.components as object[],
      bodyText: analysis.bodyText,
      bodyParameters: analysis.bodyParameters,
      supported: analysis.supported,
      unsupportedReason: analysis.unsupportedReason,
      lastSyncedAt: clockTime,
      ...extra,
    },
  });
}

describe('WhatsApp pela API: opt-in por número e envio (F7-01, F7-05)', () => {
  let admin: UserActor;
  let manager: UserActor;
  let sdr: UserActor;
  let sourceId: string;
  let phone = 7300;

  const make = (name: string, overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: `(88) 99812-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
    ...overrides,
  });

  /** Lead com um celular; devolve os ids. */
  async function leadWithPhone(name: string) {
    const { id } = await createLead(deps, sdr, make(name));
    const point = await db.contactPoint.findFirstOrThrow({ where: { leadId: id } });
    return { leadId: id, contactPointId: point.id, e164: point.valueNormalized };
  }

  async function grantByForm(leadId: string, contactPointId: string) {
    await recordWhatsappOptIn(deps, manager, {
      leadId,
      contactPointId,
      method: 'FORM',
      evidence: 'Formulário do evento fictício de 10/10/2026',
    });
  }

  /** O contato escreveu: mensagem recebida e janela aberta (como o webhook gravaria). */
  async function inbound(leadId: string, contactPointId: string, waId: string, body = 'Oi!') {
    const conversation = await db.conversation.upsert({
      where: {
        leadId_channel_externalThreadId: { leadId, channel: 'WHATSAPP', externalThreadId: waId },
      },
      create: {
        leadId,
        channel: 'WHATSAPP',
        contactPointId,
        externalThreadId: waId,
        lastInboundAt: clockTime,
        serviceWindowExpiresAt: new Date(clockTime.getTime() + 24 * 3_600_000),
      },
      update: {
        lastInboundAt: clockTime,
        serviceWindowExpiresAt: new Date(clockTime.getTime() + 24 * 3_600_000),
      },
    });
    return db.message.create({
      data: {
        leadId,
        contactPointId,
        conversationId: conversation.id,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        mode: 'API',
        status: 'RECEIVED',
        body,
        receivedAt: clockTime,
        provider: 'fake',
        providerMessageId: `wamid.in-${contactPointId}-${clockTime.getTime()}`,
      },
    });
  }

  const apiGate = async (leadId: string) =>
    (await getLeadContactability(deps, sdr, { leadId, mode: 'API' })).channels.find(
      (c) => c.channel === 'WHATSAPP',
    )!;

  beforeEach(async () => {
    at('2026-10-13T12:00:00Z');
    await resetTestData(db);
    fake.sent.length = 0;
    enqueued.length = 0;
    deps.whatsapp = fake;
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
    // Vários envios ao mesmo lead no mesmo teste.
    await updateContactRules(deps, admin, { ...DEFAULT_CONTACT_RULES, minHoursBetweenContacts: 0 });
  });
  afterAll(() => closeTestDb());

  it('opt-in do número: evidência conferida, perfis, Lista Não Contatar e revogação', async () => {
    const { leadId, contactPointId } = await leadWithPhone('Escritório Ipê');
    expect((await apiGate(leadId)).allowed).toBe(false);

    // Formulário, evento… só ADMIN/GESTOR, e com a evidência descrita.
    await expectError(
      recordWhatsappOptIn(deps, sdr, {
        leadId,
        contactPointId,
        method: 'FORM',
        evidence: 'Formulário',
      }),
      ForbiddenError,
    );
    const missing = await expectError(
      recordWhatsappOptIn(deps, manager, { leadId, contactPointId, method: 'EVENT' }),
      ValidationError,
    );
    expect(missing.issues[0]!.path).toBe('evidence');
    await grantByForm(leadId, contactPointId);
    expect(await apiGate(leadId)).toMatchObject({
      allowed: true,
      usableContactPointIds: [contactPointId],
    });
    expect(
      await db.contactPermission.findFirstOrThrow({ where: { contactPointId } }),
    ).toMatchObject({
      channel: 'WHATSAPP',
      legalBasis: 'LEGITIMATE_INTEREST',
      optInStatus: 'GRANTED',
      optInMethod: 'FORM',
      recordedById: manager.id,
    });

    // Revogar: qualquer pessoa que edita o lead.
    await revokeWhatsappOptIn(deps, sdr, { leadId, contactPointId, reason: 'Pediu por telefone' });
    expect((await apiGate(leadId)).allowed).toBe(false);

    // "O contato escreveu concordando": o SDR aponta a mensagem desse número.
    const other = await leadWithPhone('Escritório Jacarandá');
    const foreign = await inbound(other.leadId, other.contactPointId, '5588998100000');
    const wrong = await expectError(
      recordWhatsappOptIn(deps, sdr, {
        leadId,
        contactPointId,
        method: 'INBOUND_MESSAGE',
        evidenceMessageId: foreign.id,
      }),
      ValidationError,
    );
    expect(wrong.issues[0]!.path).toBe('evidenceMessageId');
    const message = await inbound(leadId, contactPointId, '558899812001', 'Pode mandar por aqui');
    await recordWhatsappOptIn(deps, sdr, {
      leadId,
      contactPointId,
      method: 'INBOUND_MESSAGE',
      evidenceMessageId: message.id,
    });
    expect(
      await db.contactPermission.findFirstOrThrow({ where: { contactPointId } }),
    ).toMatchObject({ optInStatus: 'GRANTED', evidenceMessageId: message.id });

    // Opt-out derruba o opt-in; depois, a Lista Não Contatar impede um novo.
    await registerOptOut(deps, sdr, { leadId });
    expect(
      (await db.contactPermission.findFirstOrThrow({ where: { contactPointId } })).optInStatus,
    ).toBe('REVOKED');
    await expectError(grantByForm(leadId, contactPointId), BusinessRuleError);
    expect(
      await db.leadEvent.count({ where: { leadId, type: 'permission.changed' } }),
    ).toBeGreaterThanOrEqual(3);
  });

  it('modelo aprovado: fila, job, primeiro contato e etapa; pedido repetido não duplica', async () => {
    const { leadId, contactPointId, e164 } = await leadWithPhone('Escritório Aroeira');
    const template = await approvedTemplate();
    // Sem opt-in, nem modelo.
    await expectError(
      sendWhatsappMessage(deps, sdr, {
        kind: 'template',
        leadId,
        templateId: template.id,
        params: { '1': 'Ana', '2': 'Sobral' },
      }),
      BusinessRuleError,
    );
    await grantByForm(leadId, contactPointId);
    // Texto livre fora da janela: não.
    await expect(
      sendWhatsappMessage(deps, sdr, { kind: 'text', leadId, body: 'Olá!' }),
    ).rejects.toThrow(/Texto livre só dentro de 24 h/);
    const invalid = await expectError(
      sendWhatsappMessage(deps, sdr, {
        kind: 'template',
        leadId,
        templateId: template.id,
        params: { '1': 'Ana' },
      }),
      ValidationError,
    );
    expect(invalid.issues).toEqual([{ path: 'params.2', message: 'Preencha esta variável.' }]);

    const request = {
      kind: 'template' as const,
      leadId,
      templateId: template.id,
      params: { '1': 'Ana', '2': 'Sobral' },
      messageType: 'FIRST_CONTACT' as const,
      clientRequestId: 'pedido-0001',
    };
    const queued = await sendWhatsappMessage(deps, sdr, request);
    expect(queued).toMatchObject({ status: 'QUEUED', mode: 'API', isFirstContact: false });
    expect(queued.body).toContain('Olá, Ana!');
    expect(queued.body).toContain('em Sobral');
    // Clique repetido: a mesma mensagem.
    expect((await sendWhatsappMessage(deps, sdr, request)).id).toBe(queued.id);
    expect(enqueued.filter((j) => j.name === 'whatsapp.send')).toHaveLength(1);

    expect(await runWhatsappSend(deps, { messageId: queued.id })).toEqual({ status: 'sent' });
    expect(fake.sent).toEqual([
      expect.objectContaining({
        kind: 'template',
        to: e164.slice(1),
        reference: queued.id,
        template: expect.objectContaining({
          name: 'apresentacao_parceria',
          bodyParameters: [
            { name: '1', value: 'Ana' },
            { name: '2', value: 'Sobral' },
          ],
        }),
      }),
    ]);
    const sent = await db.message.findUniqueOrThrow({
      where: { id: queued.id },
      include: { statusEvents: true, conversation: true },
    });
    expect(sent).toMatchObject({
      status: 'SENT',
      provider: 'fake',
      providerMessageId: fake.sent[0]!.providerMessageId,
      isFirstContact: true,
      sentById: sdr.id,
      whatsappTemplateId: template.id,
      sentAt: clockTime,
    });
    expect(sent.statusEvents.map((e) => e.status)).toEqual(['SENT']);
    expect(sent.conversation).toMatchObject({ lastOutboundAt: clockTime, contactPointId });
    expect(
      await db.lead.findUniqueOrThrow({ where: { id: leadId }, include: { stage: true } }),
    ).toMatchObject({ firstContactAt: clockTime, stage: { key: 'FIRST_CONTACT' } });
    expect(await db.leadEvent.count({ where: { leadId, type: 'message.sent' } })).toBe(1);

    // O job de novo (fila repetida) não reenvia.
    expect(await runWhatsappSend(deps, { messageId: queued.id })).toEqual({ status: 'skipped' });
    expect(fake.sent).toHaveLength(1);

    // Modelo ainda em análise na Meta não é enviado.
    const pending = await approvedTemplate(4);
    await expect(
      sendWhatsappMessage(deps, sdr, {
        kind: 'template',
        leadId,
        templateId: pending.id,
        params: { '1': 'Ana' },
      }),
    ).rejects.toThrow(/não está aprovado/);
  });

  it('texto livre e rascunho da IA dentro da janela aberta pelo contato, sem opt-in', async () => {
    const { leadId, contactPointId } = await leadWithPhone('Escritório Baobá');
    await inbound(leadId, contactPointId, '558899812001', 'Quero saber mais');
    expect(await apiGate(leadId)).toMatchObject({ allowed: true });
    // Modelo exige opt-in mesmo com a janela aberta.
    const template = await approvedTemplate();
    await expect(
      sendWhatsappMessage(deps, sdr, {
        kind: 'template',
        leadId,
        templateId: template.id,
        params: { '1': 'Ana', '2': 'Sobral' },
      }),
    ).rejects.toThrow(/não tem opt-in/);

    const text = await sendWhatsappMessage(deps, sdr, {
      kind: 'text',
      leadId,
      body: 'Claro! Posso te ligar às 15h?',
      messageType: 'INTERESTED_REPLY',
    });
    await runWhatsappSend(deps, { messageId: text.id });
    expect(fake.sent[0]).toMatchObject({
      kind: 'text',
      to: '558899812001',
      body: 'Claro! Posso te ligar às 15h?',
    });

    const draft = await db.aiGeneration.create({
      data: {
        leadId,
        kind: 'SCHEDULING',
        promptId: 'outreach_message',
        promptVersion: 1,
        provider: 'fake',
        model: 'fake-sdr',
        params: {},
        inputSnapshot: {},
        status: 'APPROVED',
        textFinal: 'Combinado: amanhã às 10h.',
        approvedById: sdr.id,
        approvedAt: clockTime,
      },
    });
    const fromDraft = await sendWhatsappMessage(deps, sdr, {
      kind: 'text',
      leadId,
      aiGenerationId: draft.id,
    });
    expect(fromDraft).toMatchObject({
      body: 'Combinado: amanhã às 10h.',
      messageType: 'SCHEDULING',
    });
    await expect(
      sendWhatsappMessage(deps, sdr, { kind: 'text', leadId, aiGenerationId: draft.id }),
    ).rejects.toThrow(/já tem um envio/);
    await runWhatsappSend(deps, { messageId: fromDraft.id });
    expect((await db.aiGeneration.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe(
      'SENT',
    );

    // Passadas 24 h da última mensagem do contato, só modelo (e com opt-in).
    at('2026-10-14T12:30:00Z');
    expect((await apiGate(leadId)).allowed).toBe(false);
  });

  it('falhas: janela fechada na Meta, opt-out de marketing, resultado incerto e gate na hora do envio', async () => {
    const { leadId, contactPointId } = await leadWithPhone('Escritório Caju');
    await grantByForm(leadId, contactPointId);
    await inbound(leadId, contactPointId, '558899812001');
    const send = (body: string) => sendWhatsappMessage(deps, sdr, { kind: 'text', leadId, body });

    // 131047: falha conhecida, aviso a quem pediu, pode tentar de novo.
    const closed = await send('Oi [fake:janela-fechada]');
    expect(await runWhatsappSend(deps, { messageId: closed.id })).toEqual({
      status: 'failed',
      code: '131047',
    });
    expect(await db.message.findUniqueOrThrow({ where: { id: closed.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: '131047',
      errorDetail: expect.stringMatching(/24 horas/),
    });
    expect(
      await db.notification.findFirstOrThrow({
        where: { userId: sdr.id, type: 'whatsapp.failed' },
      }),
    ).toMatchObject({ leadId, title: 'WhatsApp não enviado para Escritório Caju' });
    expect(await retryWhatsappMessage(deps, sdr, { messageId: closed.id })).toMatchObject({
      status: 'QUEUED',
    });

    // Resultado incerto: nunca repete sozinho; reenvio só depois de 10 min e com confirmação.
    const uncertain = await send('Oi [fake:incerto]');
    await runWhatsappSend(deps, { messageId: uncertain.id });
    expect(await db.message.findUniqueOrThrow({ where: { id: uncertain.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'TIMEOUT',
    });
    await expect(retryWhatsappMessage(deps, sdr, { messageId: uncertain.id })).rejects.toThrow(
      /Aguarde 10 minutos/,
    );
    at('2026-10-13T12:11:00Z');
    await expect(retryWhatsappMessage(deps, sdr, { messageId: uncertain.id })).rejects.toThrow(
      /risco de o contato receber duas vezes/,
    );
    await retryWhatsappMessage(deps, sdr, { messageId: uncertain.id, confirmDuplicateRisk: true });

    // Uma tentativa anterior caiu no meio (já marcada): não chama a Meta de novo.
    const crashed = await send('Oi de novo');
    await db.message.update({ where: { id: crashed.id }, data: { sendAttemptedAt: clockTime } });
    const before = fake.sent.length;
    await runWhatsappSend(deps, { messageId: crashed.id });
    expect(fake.sent).toHaveLength(before);
    expect((await db.message.findUniqueOrThrow({ where: { id: crashed.id } })).errorCode).toBe(
      'CONNECTION_LOST',
    );

    // 131050: o contato pediu à Meta para parar o marketing → Lista Não Contatar no WhatsApp.
    const template = await approvedTemplate();
    const marketing = await sendWhatsappMessage(deps, sdr, {
      kind: 'template',
      leadId,
      templateId: template.id,
      params: { '1': 'Ana [fake:opt-out]', '2': 'Sobral' },
    });
    await runWhatsappSend(deps, { messageId: marketing.id });
    expect(
      await db.suppressionEntry.findFirstOrThrow({ where: { scope: 'WHATSAPP', type: 'PHONE' } }),
    ).toMatchObject({ reason: 'OPT_OUT', source: 'WEBHOOK', leadId });
    expect(
      (await db.contactPermission.findFirstOrThrow({ where: { contactPointId } })).optInStatus,
    ).toBe('REVOKED');
    await expect(retryWhatsappMessage(deps, sdr, { messageId: marketing.id })).rejects.toThrow(
      /não reenvie/,
    );
    expect((await apiGate(leadId)).allowed).toBe(false);
  });

  it('gate conferido de novo no envio; API desligada no modo assistido', async () => {
    const { leadId, contactPointId } = await leadWithPhone('Escritório Dendê');
    await grantByForm(leadId, contactPointId);
    const template = await approvedTemplate();
    const queued = await sendWhatsappMessage(deps, sdr, {
      kind: 'template',
      leadId,
      templateId: template.id,
      params: { '1': 'Ana', '2': 'Sobral' },
    });
    // Opt-out entre o pedido e o envio: nada sai.
    await registerOptOut(deps, sdr, { leadId });
    await runWhatsappSend(deps, { messageId: queued.id });
    expect(fake.sent).toEqual([]);
    expect(await db.message.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'GATE_BLOCKED',
      errorDetail: expect.stringMatching(/Lista Não Contatar/),
    });

    deps.whatsapp = null;
    await expect(
      sendWhatsappMessage(deps, sdr, { kind: 'text', leadId, body: 'Oi' }),
    ).rejects.toThrow(/não está ativo/);
  });
});
