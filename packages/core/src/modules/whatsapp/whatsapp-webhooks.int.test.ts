import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { systemActor, type Actor } from '../../shared/actor';
import { BusinessRuleError, ForbiddenError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { runDuplicateScan, mergeDuplicate } from '../dedup';
import { enrollLead } from '../cadence';
import { anonymizeLead, createLead, type CreateLeadInput } from '../leads';
import { DEFAULT_CONTACT_RULES, updateContactRules } from '../settings';
import {
  checkWhatsappHealth,
  dismissUnmatchedInbound,
  getLeadWhatsapp,
  getWhatsappOverview,
  listConversations,
  retryUnmatchedInbound,
  FAKE_TEMPLATES,
  FakeWhatsappProvider,
  linkUnmatchedInbound,
  listUnmatchedInbound,
  receiveWhatsappWebhook,
  recordWhatsappOptIn,
  runWebhooksPurge,
  runWhatsappSend,
  runWhatsappSuggestClassification,
  runWhatsappWebhook,
  sendWhatsappMessage,
  syncWhatsappTemplates,
  updateWhatsappTemplate,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, enqueued, whatsapp: fake, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;

/** Corpo de webhook no formato da Meta (números fictícios). */
const unix = (iso: string) => String(Math.floor(new Date(iso).getTime() / 1000));
const body = (field: string, value: object) =>
  JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: '100000000000001', changes: [{ field, value }] }],
  });
const inboundBody = (from: string, id: string, text: string, iso: string) =>
  body('messages', {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: '200000000000002' },
    contacts: [{ wa_id: from, profile: { name: 'Contato Fictício' } }],
    messages: [{ from, id, timestamp: unix(iso), type: 'text', text: { body: text } }],
  });
const statusBody = (statuses: object[]) =>
  body('messages', { messaging_product: 'whatsapp', statuses });

/** Recebe como a rota (assinatura já conferida) e processa como o worker. */
async function deliver(rawBody: string) {
  const before = enqueued.length;
  const result = await receiveWhatsappWebhook(deps, systemActor('teste'), {
    provider: 'fake',
    rawBody,
  });
  for (const job of enqueued.slice(before)) {
    if (job.name === 'whatsapp.webhook') await runWhatsappWebhook(deps, job.data);
  }
  return result;
}

describe('WhatsApp pela API: webhooks (F7-02, F7-03, F7-04, F7-06, F7-07, F7-08)', () => {
  let admin: UserActor;
  let manager: UserActor;
  let sdr: UserActor;
  let sourceId: string;
  let phone = 7400;

  const make = (name: string, overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: `(88) 99812-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
    ...overrides,
  });

  async function leadWithPhone(name: string, overrides: Partial<CreateLeadInput> = {}) {
    const { id } = await createLead(deps, sdr, make(name, overrides));
    const point = await db.contactPoint.findFirstOrThrow({ where: { leadId: id } });
    await db.lead.update({ where: { id }, data: { ownerId: sdr.id } });
    const waId = point.valueNormalized.slice(1);
    // O wa_id de contas antigas vem sem o 9º dígito (F7-06).
    const waIdWithout9 = waId.replace(/^(55\d{2})9/, '$1');
    return { leadId: id, contactPointId: point.id, waId, waIdWithout9 };
  }

  /** Modelo aprovado sincronizado e opt-in do número: pronto para enviar. */
  async function sentTemplate(leadId: string, contactPointId: string) {
    await recordWhatsappOptIn(deps, manager, {
      leadId,
      contactPointId,
      method: 'FORM',
      evidence: 'Formulário fictício',
    });
    const template = await db.whatsappTemplate.findFirstOrThrow({
      where: { name: 'apresentacao_parceria' },
    });
    const queued = await sendWhatsappMessage(deps, sdr, {
      kind: 'template',
      leadId,
      templateId: template.id,
      params: { '1': 'Ana', '2': 'Sobral' },
    });
    await runWhatsappSend(deps, { messageId: queued.id });
    return db.message.findUniqueOrThrow({ where: { id: queued.id } });
  }

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
    await updateContactRules(deps, admin, { ...DEFAULT_CONTACT_RULES, minHoursBetweenContacts: 0 });
    await syncWhatsappTemplates(deps, admin);
  });
  afterAll(() => closeTestDb());

  it('status fora de ordem, custo estimado, número confirmado e webhook repetido', async () => {
    const { leadId, contactPointId, waId } = await leadWithPhone('Escritório Ipê');
    const sent = await sentTemplate(leadId, contactPointId);
    expect(sent.status).toBe('SENT');

    const raw = statusBody([
      {
        id: sent.providerMessageId,
        status: 'read',
        timestamp: unix('2026-10-13T12:02:00Z'),
        recipient_id: waId,
      },
      {
        id: sent.providerMessageId,
        status: 'delivered',
        timestamp: unix('2026-10-13T12:01:00Z'),
        recipient_id: waId,
        biz_opaque_callback_data: sent.id,
        pricing: { billable: true, pricing_model: 'PMP', type: 'regular', category: 'marketing' },
      },
    ]);
    expect(await deliver(raw)).toEqual({ duplicate: false, events: 2 });
    const after = await db.message.findUniqueOrThrow({
      where: { id: sent.id },
      include: { statusEvents: { orderBy: { occurredAt: 'asc' } } },
    });
    expect(after).toMatchObject({
      status: 'READ',
      deliveredAt: new Date('2026-10-13T12:02:00Z'),
      readAt: new Date('2026-10-13T12:02:00Z'),
      pricingCategory: 'marketing',
      billable: true,
    });
    expect(Number(after.costEstimateUsd)).toBe(0.0625);
    expect(after.statusEvents.map((e) => e.status).sort()).toEqual(['DELIVERED', 'READ', 'SENT']);
    expect(
      (await db.contactPoint.findUniqueOrThrow({ where: { id: contactPointId } })).whatsappStatus,
    ).toBe('CONFIRMED');
    expect(await db.webhookEvent.findFirstOrThrow()).toMatchObject({
      status: 'PROCESSED',
      attempts: 1,
      contactHashes: [
        (await db.contactPoint.findUniqueOrThrow({ where: { id: contactPointId } })).valueHash,
      ],
    });

    // A Meta reenvia o mesmo corpo: nada se repete.
    expect(await deliver(raw)).toEqual({ duplicate: true, events: 2 });
    expect(await db.webhookEvent.count()).toBe(1);
  });

  it('reconciliação: o status corrige um envio de resultado incerto; falha depois do envio', async () => {
    const { leadId, contactPointId, waId } = await leadWithPhone('Escritório Jatobá');
    await deliver(inboundBody(waId, 'wamid.in-1', 'Oi, tudo bem?', '2026-10-13T11:59:00Z'));
    const uncertain = await sendWhatsappMessage(deps, sdr, {
      kind: 'text',
      leadId,
      body: 'Tudo ótimo! [fake:incerto]',
    });
    await runWhatsappSend(deps, { messageId: uncertain.id });
    expect((await db.message.findUniqueOrThrow({ where: { id: uncertain.id } })).status).toBe(
      'FAILED',
    );
    // A mensagem tinha saído: o status chega com o nosso id.
    await deliver(
      statusBody([
        {
          id: 'wamid.recuperado',
          status: 'sent',
          timestamp: unix('2026-10-13T12:00:05Z'),
          recipient_id: waId,
          biz_opaque_callback_data: uncertain.id,
        },
      ]),
    );
    expect(await db.message.findUniqueOrThrow({ where: { id: uncertain.id } })).toMatchObject({
      status: 'SENT',
      providerMessageId: 'wamid.recuperado',
      errorCode: null,
      sentAt: new Date('2026-10-13T12:00:05Z'),
    });
    expect(await db.leadEvent.count({ where: { leadId, type: 'message.sent' } })).toBe(1);

    // Falha avisada depois (131050): número na Lista Não Contatar do WhatsApp.
    const sent = await sentTemplate(leadId, contactPointId);
    await deliver(
      statusBody([
        {
          id: sent.providerMessageId,
          status: 'failed',
          timestamp: unix('2026-10-13T12:03:00Z'),
          recipient_id: waId,
          errors: [{ code: 131050, title: 'Unable to deliver the message' }],
        },
      ]),
    );
    expect(await db.message.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: '131050',
    });
    expect(
      await db.suppressionEntry.count({ where: { scope: 'WHATSAPP', reason: 'OPT_OUT' } }),
    ).toBe(1);
  });

  it('resposta recebida: número sem o 9º dígito, janela, cadência, etapa, aviso e sugestão da IA', async () => {
    const { leadId, contactPointId, waIdWithout9 } = await leadWithPhone('Escritório Aroeira');
    await enrollLead(deps, sdr, { leadId });
    await deliver(
      inboundBody(
        waIdWithout9,
        'wamid.resposta-1',
        'Tenho interesse, me conta mais',
        '2026-10-13T11:58:00Z',
      ),
    );
    const message = await db.message.findFirstOrThrow({
      where: { leadId, direction: 'INBOUND' },
      include: { conversation: true },
    });
    expect(message).toMatchObject({
      mode: 'API',
      status: 'RECEIVED',
      provider: 'fake',
      providerMessageId: 'wamid.resposta-1',
      contactPointId,
      body: 'Tenho interesse, me conta mais',
      receivedAt: new Date('2026-10-13T11:58:00Z'),
      classification: null,
    });
    expect(message.conversation).toMatchObject({
      externalThreadId: waIdWithout9,
      profileName: 'Contato Fictício',
      serviceWindowExpiresAt: new Date('2026-10-14T11:58:00Z'),
    });
    const lead = await db.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { stage: true, enrollments: true },
    });
    expect(lead.stage?.key).toBe('REPLIED');
    expect(lead.enrollments[0]).toMatchObject({ status: 'STOPPED', stopReason: 'REPLIED' });
    expect(await db.task.count({ where: { leadId, type: 'REPLY_NEEDED', status: 'OPEN' } })).toBe(
      1,
    );
    expect(
      await db.notification.findFirstOrThrow({ where: { type: 'whatsapp.received' } }),
    ).toMatchObject({ userId: sdr.id, leadId });
    expect(
      (await db.contactPoint.findUniqueOrThrow({ where: { id: contactPointId } })).whatsappStatus,
    ).toBe('CONFIRMED');

    // Sugestão da IA na fila; ela sugere, não classifica.
    const job = enqueued.find((j) => j.name === 'whatsapp.suggest-classification');
    expect(job?.data).toEqual({ messageId: message.id });
    expect(await runWhatsappSuggestClassification(deps, job!.data)).toEqual({
      status: 'suggested',
    });
    expect(
      await db.aiGeneration.findFirstOrThrow({ where: { sourceMessageId: message.id } }),
    ).toMatchObject({ kind: 'REPLY_CLASSIFICATION', requestedById: null });
    expect(
      (await db.message.findUniqueOrThrow({ where: { id: message.id } })).classification,
    ).toBeNull();

    // A mesma mensagem em outro webhook: não duplica.
    await deliver(
      inboundBody(
        waIdWithout9,
        'wamid.resposta-1',
        'Tenho interesse, me conta mais',
        '2026-10-13T11:58:00Z',
      ).replace('"Contato Fictício"', '"Contato Fictício 2"'),
    );
    expect(await db.message.count({ where: { leadId, direction: 'INBOUND' } })).toBe(1);

    // "Sair": opt-out na hora, sem pedir sugestão à IA.
    enqueued.length = 0;
    await deliver(inboundBody(waIdWithout9, 'wamid.resposta-2', 'Sair', '2026-10-13T12:00:00Z'));
    expect(
      await db.message.findFirstOrThrow({ where: { providerMessageId: 'wamid.resposta-2' } }),
    ).toMatchObject({ classification: 'OPT_OUT', classificationSource: 'RULE' });
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).contactStatus).toBe(
      'OPTED_OUT',
    );
    expect(enqueued.some((j) => j.name === 'whatsapp.suggest-classification')).toBe(false);
  });

  it('números sem lead ou em dois leads: uma pessoa vincula ou descarta', async () => {
    await deliver(
      inboundBody(
        '5585999990000',
        'wamid.desconhecido',
        'Quero saber da parceria',
        '2026-10-13T11:00:00Z',
      ),
    );
    const shared = '(88) 99812-7499';
    const a = await leadWithPhone('Escritório Bacuri', {
      contactPoints: [{ type: 'PHONE', value: shared, isWhatsapp: true }],
    });
    const b = await leadWithPhone('Escritório Bacuri Filial', {
      contactPoints: [{ type: 'PHONE', value: shared, isWhatsapp: true }],
    });
    await deliver(inboundBody(a.waId, 'wamid.ambiguo', 'Oi', '2026-10-13T11:30:00Z'));

    await expect(listUnmatchedInbound(deps, sdr, {})).rejects.toBeInstanceOf(ForbiddenError);
    const pending = await listUnmatchedInbound(deps, manager, {});
    expect(pending.map((p) => [p.providerMessageId, p.candidates.length])).toEqual([
      ['wamid.ambiguo', 2],
      ['wamid.desconhecido', 0],
    ]);
    expect(pending[1]).toMatchObject({
      phoneE164: '+5585999990000',
      body: 'Quero saber da parceria',
    });
    expect(
      await db.notification.count({
        where: { type: 'whatsapp.unmatched', userId: { in: [admin.id, manager.id] } },
      }),
    ).toBe(4);
    expect(
      await db.notification.count({ where: { type: 'whatsapp.unmatched', userId: sdr.id } }),
    ).toBe(0);

    // Lead sem o telefone da mensagem: cadastre o telefone antes.
    const other = await leadWithPhone('Escritório Cajá');
    await expect(
      linkUnmatchedInbound(deps, manager, { unmatchedId: pending[1]!.id, leadId: other.leadId }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    await linkUnmatchedInbound(deps, manager, { unmatchedId: pending[0]!.id, leadId: b.leadId });
    expect(
      await db.message.findFirstOrThrow({ where: { providerMessageId: 'wamid.ambiguo' } }),
    ).toMatchObject({ leadId: b.leadId, mode: 'API', direction: 'INBOUND' });
    await dismissUnmatchedInbound(deps, manager, { unmatchedId: pending[1]!.id });
    expect(await listUnmatchedInbound(deps, manager, {})).toEqual([]);
    // Depois do vínculo, a próxima mensagem desse número vai direto para o lead (pela conversa).
    await deliver(inboundBody(a.waId, 'wamid.depois', 'Alguma novidade?', '2026-10-13T11:45:00Z'));
    expect(
      (await db.message.findFirstOrThrow({ where: { providerMessageId: 'wamid.depois' } })).leadId,
    ).toBe(b.leadId);
  });

  it('modelos: sincronização, decisões do ADMIN preservadas, situação e qualidade pela Meta', async () => {
    await expect(syncWhatsappTemplates(deps, sdr)).rejects.toBeInstanceOf(ForbiddenError);
    const templates = await db.whatsappTemplate.findMany({ orderBy: { name: 'asc' } });
    expect(templates.map((t) => [t.name, t.status, t.supported])).toEqual([
      ['apresentacao_parceria', 'APPROVED', true],
      ['confirmacao_reuniao', 'APPROVED', true],
      ['convite_evento_imagem', 'APPROVED', false],
      ['novidades_mensais', 'PENDING', true],
      ['retomada_contato', 'APPROVED', true],
    ]);
    const approach = await db.approach.create({ data: { key: 'PARCERIA', name: 'Parceria' } });
    const apresentacao = templates[0]!;
    await expect(
      updateWhatsappTemplate(deps, manager, { templateId: apresentacao.id, active: false }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await updateWhatsappTemplate(deps, admin, {
      templateId: apresentacao.id,
      approachId: approach.id,
      active: false,
    });

    // A conta perdeu um modelo: fica marcado como removido; as decisões do ADMIN ficam.
    deps.whatsapp = new FakeWhatsappProvider(FAKE_TEMPLATES.slice(0, 3));
    expect(await syncWhatsappTemplates(deps, admin)).toEqual({
      created: 0,
      updated: 3,
      removed: 2,
    });
    expect(
      await db.whatsappTemplate.findUniqueOrThrow({ where: { id: apresentacao.id } }),
    ).toMatchObject({ approachId: approach.id, active: false, removedAt: null });
    expect(await db.whatsappTemplate.count({ where: { removedAt: { not: null } } })).toBe(2);

    await deliver(
      body('message_template_status_update', {
        event: 'PAUSED',
        message_template_id: 'fake-tpl-retomada',
        reason: null,
      }),
    );
    await deliver(
      body('message_template_quality_update', {
        previous_quality_score: 'GREEN',
        new_quality_score: 'YELLOW',
        message_template_id: 'fake-tpl-apresentacao',
      }),
    );
    expect(
      await db.whatsappTemplate.findUniqueOrThrow({
        where: { metaTemplateId: 'fake-tpl-retomada' },
      }),
    ).toMatchObject({ status: 'PAUSED' });
    expect(
      await db.whatsappTemplate.findUniqueOrThrow({ where: { id: apresentacao.id } }),
    ).toMatchObject({ qualityScore: 'YELLOW' });
  });

  it('saúde do número: qualidade boa, piora com aviso aos ADMINs, webhook pede nova checagem', async () => {
    expect(await checkWhatsappHealth(deps, admin)).toEqual({ status: 'ACTIVE' });
    expect(
      await db.integrationConnection.findUniqueOrThrow({ where: { provider: 'fake' } }),
    ).toMatchObject({
      status: 'ACTIVE',
      config: expect.objectContaining({ qualityRating: 'GREEN', messagingLimit: 'TIER_2K' }),
    });
    const red = new FakeWhatsappProvider();
    red.getPhoneHealth = async () => ({
      displayPhoneNumber: 'Número de demonstração',
      verifiedName: null,
      qualityRating: 'RED',
      messagingLimit: 'TIER_2K',
      status: 'FLAGGED',
      nameStatus: null,
    });
    deps.whatsapp = red;
    expect(await checkWhatsappHealth(deps, admin)).toEqual({ status: 'DEGRADED' });
    expect(
      await db.notification.count({ where: { userId: admin.id, type: 'whatsapp.integration' } }),
    ).toBe(1);
    // Continua ruim: não repete o aviso.
    await checkWhatsappHealth(deps, admin);
    expect(
      await db.notification.count({ where: { userId: admin.id, type: 'whatsapp.integration' } }),
    ).toBe(1);

    enqueued.length = 0;
    await deliver(
      body('phone_number_quality_update', { event: 'DOWNGRADE', current_limit: 'TIER_250' }),
    );
    expect(enqueued.map((j) => j.name)).toContain('whatsapp.health-check');
  });

  it('leituras: ficha, conversas no escopo, visão do mês; "procurar de novo" depois do cadastro', async () => {
    const { leadId, contactPointId, waId } = await leadWithPhone('Escritório Umbu');
    const sent = await sentTemplate(leadId, contactPointId);
    await deliver(
      statusBody([
        {
          id: sent.providerMessageId,
          status: 'delivered',
          timestamp: unix('2026-10-13T12:01:00Z'),
          recipient_id: waId,
          pricing: { billable: true, category: 'marketing' },
        },
      ]),
    );
    await deliver(inboundBody(waId, 'wamid.leitura', 'Pode ser amanhã?', '2026-10-13T12:05:00Z'));
    at('2026-10-13T12:10:00Z');

    const view = await getLeadWhatsapp(deps, sdr, { leadId });
    expect(view).toMatchObject({ provider: 'fake', leadActive: true, gate: { allowed: true } });
    expect(view.numbers).toEqual([
      expect.objectContaining({
        contactPointId,
        display: expect.stringMatching(/^\(88\) 99812-/),
        optIn: expect.objectContaining({ status: 'GRANTED', method: 'FORM' }),
        window: { open: true, expiresAt: new Date('2026-10-14T12:05:00Z') },
        usable: true,
      }),
    ]);
    expect(view.messages.map((m) => [m.direction, m.status, m.retry])).toEqual([
      ['OUTBOUND', 'DELIVERED', 'none'],
      ['INBOUND', 'RECEIVED', 'none'],
    ]);
    expect(view.templates.map((t) => t.name)).toEqual([
      'apresentacao_parceria',
      'confirmacao_reuniao',
      'retomada_contato',
    ]);

    // Conversas: o SDR vê as dos seus leads; a que espera resposta aparece em destaque.
    const otherSdr = (await createActor('SDR')).actor;
    expect(await listConversations(deps, otherSdr, {})).toEqual([]);
    const attention = await listConversations(deps, sdr, { filter: 'attention' });
    expect(attention).toEqual([
      expect.objectContaining({
        awaitingReply: true,
        lead: expect.objectContaining({ id: leadId }),
      }),
    ]);

    const overview = await getWhatsappOverview(deps, admin, {});
    expect(overview).toMatchObject({
      provider: 'fake',
      month: '2026-10',
      totals: { requested: 1, accepted: 1, delivered: 1, read: 0, failed: 0, costUsd: 0.0625 },
      byCategory: [{ category: 'marketing', count: 1, costUsd: 0.0625 }],
    });
    await expect(getWhatsappOverview(deps, manager, {})).rejects.toBeInstanceOf(ForbiddenError);

    // Número que ainda não estava em lead: cadastrado depois, "procurar de novo" casa a mensagem.
    await deliver(inboundBody('5588998127499', 'wamid.novo', 'Olá', '2026-10-13T12:06:00Z'));
    const [pending] = await listUnmatchedInbound(deps, manager, {});
    await expect(
      retryUnmatchedInbound(deps, manager, { unmatchedId: pending!.id }),
    ).rejects.toThrow(/Ainda não há lead ativo/);
    const later = await leadWithPhone('Escritório Novo', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99812-7499', isWhatsapp: true }],
    });
    expect(await retryUnmatchedInbound(deps, manager, { unmatchedId: pending!.id })).toEqual({
      leadId: later.leadId,
    });
    expect(
      await db.message.findFirstOrThrow({ where: { providerMessageId: 'wamid.novo' } }),
    ).toMatchObject({ leadId: later.leadId, direction: 'INBOUND' });
  });

  it('mesclagem leva conversas e opt-in; anonimização e purga apagam o que cita o titular', async () => {
    const survivor = await leadWithPhone('Escritório Ômega', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99812-7480', isWhatsapp: true }],
    });
    const merged = await leadWithPhone('Escritório Ômega Contábil', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99812-7480', isWhatsapp: true }],
    });
    await recordWhatsappOptIn(deps, manager, {
      leadId: merged.leadId,
      contactPointId: merged.contactPointId,
      method: 'FORM',
      evidence: 'Formulário fictício',
    });
    await db.conversation.create({
      data: {
        leadId: merged.leadId,
        channel: 'WHATSAPP',
        contactPointId: merged.contactPointId,
        externalThreadId: merged.waId,
        lastInboundAt: clockTime,
        serviceWindowExpiresAt: new Date(clockTime.getTime() + 3_600_000),
      },
    });
    await runDuplicateScan(deps);
    const candidate = await db.duplicateCandidate.findFirstOrThrow();
    await mergeDuplicate(deps, manager, { candidateId: candidate.id, survivorId: survivor.leadId });
    expect(
      await db.conversation.findFirstOrThrow({ where: { externalThreadId: merged.waId } }),
    ).toMatchObject({ leadId: survivor.leadId, contactPointId: survivor.contactPointId });
    expect(
      await db.contactPermission.findFirstOrThrow({
        where: { contactPointId: survivor.contactPointId, channel: 'WHATSAPP' },
      }),
    ).toMatchObject({ leadId: survivor.leadId, optInStatus: 'GRANTED' });

    // Mensagem pelo webhook e anonimização do titular.
    await deliver(inboundBody(survivor.waId, 'wamid.titular', 'Oi', '2026-10-13T11:50:00Z'));
    expect(await db.webhookEvent.count()).toBe(1);
    await anonymizeLead(deps, admin, {
      leadId: survivor.leadId,
      reason: 'Pedido do titular (teste)',
    });
    expect(await db.conversation.count({ where: { leadId: survivor.leadId } })).toBe(0);
    expect(await db.webhookEvent.count()).toBe(0);
    expect(
      (await db.message.findFirstOrThrow({ where: { providerMessageId: 'wamid.titular' } })).body,
    ).toBeNull();

    // Purga: payloads e números sem lead com mais de 90 dias.
    await deliver(inboundBody('5585999990001', 'wamid.antigo', 'Oi', '2026-10-13T11:00:00Z'));
    at('2027-01-20T12:00:00Z');
    expect(await runWebhooksPurge(deps)).toEqual({ webhookEvents: 1, unmatched: 1 });
  });
});
