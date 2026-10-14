import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

const db = getTestDb();
const now = new Date('2026-10-13T12:00:00Z');

async function createLead(name: string) {
  const source = await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } });
  return db.lead.create({
    data: {
      displayName: name,
      nameSearch: name.toLowerCase(),
      nameCore: name.toLowerCase(),
      originSourceId: source.id,
      collectedAt: now,
      isTestData: true,
    },
  });
}

async function createPhone(leadId: string, e164: string) {
  return db.contactPoint.create({
    data: {
      leadId,
      type: 'PHONE',
      valueRaw: e164,
      valueNormalized: e164,
      valueHash: `hash-${e164}`,
      phoneKind: 'MOBILE',
    },
  });
}

const template = (extra: Record<string, unknown> = {}) =>
  db.whatsappTemplate.create({
    data: {
      metaTemplateId: 'tpl-1',
      name: 'apresentacao_parceria',
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Olá, {{1}}!' }],
      bodyText: 'Olá, {{1}}!',
      bodyParameters: ['1'],
      lastSyncedAt: now,
      ...extra,
    },
  });

describe('schema do WhatsApp (garantias no banco)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('opt-in por número: um registro por número e canal, ao lado da base legal do lead', async () => {
    const lead = await createLead('Escritório Opt-in');
    const phone = await createPhone(lead.id, '+5588998120001');
    const other = await createPhone(lead.id, '+5588998120002');
    // Base legal do lead (Fase 2) e opt-in de cada número (Fase 7) convivem.
    await db.contactPermission.create({
      data: { leadId: lead.id, channel: 'WHATSAPP', legalBasis: 'LEGITIMATE_INTEREST' },
    });
    const optIn = {
      leadId: lead.id,
      contactPointId: phone.id,
      channel: 'WHATSAPP' as const,
      legalBasis: 'LEGITIMATE_INTEREST' as const,
      optInStatus: 'GRANTED' as const,
      optInMethod: 'FORM' as const,
      optInAt: now,
      evidence: 'Formulário do site (fictício)',
    };
    await db.contactPermission.create({ data: optIn });
    await expect(db.contactPermission.create({ data: optIn })).rejects.toThrow();
    await db.contactPermission.create({ data: { ...optIn, contactPointId: other.id } });
    expect(await db.contactPermission.count({ where: { leadId: lead.id } })).toBe(3);
  });

  it('evidência de opt-in por mensagem recebida; mensagem e conversa ficam com o lead', async () => {
    const lead = await createLead('Escritório Conversa');
    const phone = await createPhone(lead.id, '+5588998120003');
    const conversation = await db.conversation.create({
      data: {
        leadId: lead.id,
        channel: 'WHATSAPP',
        contactPointId: phone.id,
        externalThreadId: '558898120003',
        lastInboundAt: now,
        serviceWindowExpiresAt: new Date(now.getTime() + 86_400_000),
      },
    });
    await expect(
      db.conversation.create({
        data: { leadId: lead.id, channel: 'WHATSAPP', externalThreadId: '558898120003' },
      }),
    ).rejects.toThrow();

    const inbound = await db.message.create({
      data: {
        leadId: lead.id,
        contactPointId: phone.id,
        conversationId: conversation.id,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        mode: 'API',
        status: 'RECEIVED',
        body: 'Pode me mandar novidades por aqui.',
        receivedAt: now,
        provider: 'fake',
        providerMessageId: 'wamid.in-1',
      },
    });
    const permission = await db.contactPermission.create({
      data: {
        leadId: lead.id,
        contactPointId: phone.id,
        channel: 'WHATSAPP',
        legalBasis: 'CONSENT',
        optInStatus: 'GRANTED',
        optInMethod: 'INBOUND_MESSAGE',
        evidenceMessageId: inbound.id,
      },
    });
    // O mesmo id do provedor não entra duas vezes (webhook repetido).
    await expect(
      db.message.create({
        data: {
          leadId: lead.id,
          channel: 'WHATSAPP',
          direction: 'INBOUND',
          mode: 'API',
          status: 'RECEIVED',
          provider: 'fake',
          providerMessageId: 'wamid.in-1',
        },
      }),
    ).rejects.toThrow();

    // Contato removido: a conversa continua com o lead, sem o ponto de contato.
    await db.contactPoint.delete({ where: { id: phone.id } });
    expect(
      await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } }),
    ).toMatchObject({ contactPointId: null, leadId: lead.id });
    expect(await db.contactPermission.findUnique({ where: { id: permission.id } })).toBeNull();
  });

  it('status: um registro por status; webhook purgado não apaga o histórico', async () => {
    const lead = await createLead('Escritório Status');
    const tpl = await template();
    const message = await db.message.create({
      data: {
        leadId: lead.id,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        mode: 'API',
        status: 'SENT',
        whatsappTemplateId: tpl.id,
        templateParams: { '1': 'Ana' },
        provider: 'fake',
        providerMessageId: 'wamid.out-1',
        sentAt: now,
      },
    });
    const event = await db.webhookEvent.create({
      data: {
        provider: 'meta_cloud',
        externalEventId: 'sha256-a',
        payload: { object: 'whatsapp_business_account', entry: [] },
        contactHashes: ['hash-x'],
        receivedAt: now,
      },
    });
    await expect(
      db.webhookEvent.create({
        data: {
          provider: 'meta_cloud',
          externalEventId: 'sha256-a',
          payload: {},
          receivedAt: now,
        },
      }),
    ).rejects.toThrow();

    await db.messageStatusEvent.create({
      data: {
        messageId: message.id,
        status: 'DELIVERED',
        occurredAt: now,
        webhookEventId: event.id,
      },
    });
    await expect(
      db.messageStatusEvent.create({
        data: { messageId: message.id, status: 'DELIVERED', occurredAt: now },
      }),
    ).rejects.toThrow();

    await db.webhookEvent.delete({ where: { id: event.id } });
    expect(await db.messageStatusEvent.findFirstOrThrow()).toMatchObject({
      status: 'DELIVERED',
      webhookEventId: null,
    });
    // Modelo removido da conta continua ligado às mensagens (só marcado).
    await db.whatsappTemplate.update({ where: { id: tpl.id }, data: { removedAt: now } });
    expect(await db.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
      whatsappTemplateId: tpl.id,
    });
  });

  it('modelos: id da Meta único; abordagem removida não apaga o modelo', async () => {
    const approach = await db.approach.create({ data: { key: 'PARCERIA', name: 'Parceria' } });
    const tpl = await template({ approachId: approach.id });
    await expect(template()).rejects.toThrow();
    await db.approach.delete({ where: { id: approach.id } });
    expect(await db.whatsappTemplate.findUniqueOrThrow({ where: { id: tpl.id } })).toMatchObject({
      approachId: null,
      active: true,
      supported: true,
    });
  });

  it('número sem lead: uma linha por mensagem do provedor; situação da integração por provedor', async () => {
    const data = {
      channel: 'WHATSAPP' as const,
      provider: 'meta_cloud',
      providerMessageId: 'wamid.unknown-1',
      externalThreadId: '558898120099',
      phoneE164: '+5588998120099',
      messageKind: 'text',
      body: 'Olá, quero saber mais.',
      receivedAt: now,
    };
    const row = await db.inboundUnmatched.create({ data });
    expect(row).toMatchObject({ status: 'PENDING', candidateLeadIds: [] });
    await expect(db.inboundUnmatched.create({ data })).rejects.toThrow();

    await db.integrationConnection.create({ data: { provider: 'meta_cloud' } });
    await expect(
      db.integrationConnection.create({ data: { provider: 'meta_cloud' } }),
    ).rejects.toThrow();
  });
});
