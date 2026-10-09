import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { systemActor, type Actor } from '../../shared/actor';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { enrollLead } from '../cadence';
import { mergeDuplicate, runDuplicateScan } from '../dedup';
import { anonymizeLead, createLead, type CreateLeadInput } from '../leads';
import { confirmAssistedMessage, prepareAssistedMessage } from '../messaging';
import { DEFAULT_CONTACT_RULES, updateContactRules } from '../settings';
import { linkUnmatchedInbound, listUnmatchedInbound } from '../whatsapp';
import {
  checkInstagramAccount,
  fakeInstagramUserId,
  getInstagramOverview,
  getLeadInstagram,
  linkInstagramUnmatched,
  listInstagramConversations,
  receiveInstagramWebhook,
  retryInstagramMessage,
  retryInstagramUnmatched,
  runInstagramSend,
  runInstagramSuggestClassification,
  runInstagramWebhook,
  sendInstagramMessage,
  sendInstagramPrivateReply,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, enqueued, instagram: fake, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;
const ACCOUNT = fake.accountId;

/** Corpos de webhook no formato da Meta (perfis fictícios). */
const ms = (iso: string) => new Date(iso).getTime();
const igBody = (iso: string, entry: object) =>
  JSON.stringify({
    object: 'instagram',
    entry: [{ id: ACCOUNT, time: Math.floor(ms(iso) / 1000), ...entry }],
  });
const dm = (igsid: string, mid: string, text: string, iso: string) =>
  igBody(iso, {
    messaging: [
      {
        sender: { id: igsid },
        recipient: { id: ACCOUNT },
        timestamp: ms(iso),
        message: { mid, text },
      },
    ],
  });
const echo = (igsid: string, mid: string, text: string, iso: string) =>
  igBody(iso, {
    messaging: [
      {
        sender: { id: ACCOUNT },
        recipient: { id: igsid },
        timestamp: ms(iso),
        message: { mid, text, is_echo: true },
      },
    ],
  });
const seen = (igsid: string, mid: string, iso: string) =>
  igBody(iso, {
    messaging: [
      { sender: { id: igsid }, recipient: { id: ACCOUNT }, timestamp: ms(iso), read: { mid } },
    ],
  });
const comment = (handle: string, id: string, text: string, iso: string, fromId?: string) =>
  igBody(iso, {
    changes: [
      {
        field: 'comments',
        value: {
          id,
          text,
          from: { id: fromId ?? fakeInstagramUserId(handle), username: handle },
          media: { id: 'media-1', media_product_type: 'FEED' },
        },
      },
    ],
  });

/** Recebe como a rota (assinatura já conferida) e processa como o worker. */
async function deliver(rawBody: string) {
  const before = enqueued.length;
  const result = await receiveInstagramWebhook(deps, systemActor('teste'), {
    provider: 'fake',
    rawBody,
  });
  for (const job of enqueued.slice(before)) {
    if (job.name === 'instagram.webhook') await runInstagramWebhook(deps, job.data);
  }
  return result;
}

/** Roda os envios que estão na fila. */
async function runSends() {
  for (const job of enqueued.filter((j) => j.name === 'instagram.send')) {
    await runInstagramSend(deps, job.data);
  }
  enqueued.length = 0;
}

describe('Instagram pela API (F8-02, F8-03)', () => {
  let admin: UserActor;
  let manager: UserActor;
  let sdr: UserActor;
  let sourceId: string;

  const make = (name: string, handle: string, overrides: Partial<CreateLeadInput> = {}) =>
    ({
      tradeName: name,
      municipalityCode: SOBRAL,
      origin: { sourceId, collectedAt: '2026-10-01' },
      legalBasis: 'LEGITIMATE_INTEREST',
      contactPoints: [{ type: 'INSTAGRAM', value: `@${handle}` }],
      acknowledgeDuplicates: true,
      ...overrides,
    }) satisfies CreateLeadInput;

  async function leadWithInstagram(name: string, handle: string) {
    const { id } = await createLead(deps, sdr, make(name, handle));
    await db.lead.update({ where: { id }, data: { ownerId: sdr.id } });
    const point = await db.contactPoint.findFirstOrThrow({ where: { leadId: id } });
    return { leadId: id, contactPointId: point.id, igsid: fakeInstagramUserId(handle) };
  }

  beforeEach(async () => {
    at('2026-10-13T12:00:00Z');
    await resetTestData(db);
    fake.sent.length = 0;
    fake.profiles.clear();
    enqueued.length = 0;
    deps.instagram = fake;
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
    await updateContactRules(deps, admin, { ...DEFAULT_CONTACT_RULES, minHoursBetweenContacts: 0 });
  });
  afterAll(() => closeTestDb());

  it('DM recebida: @ pelo perfil, janela de 24 h, cadência, etapa, aviso e sugestão da IA', async () => {
    const { leadId, contactPointId, igsid } = await leadWithInstagram(
      'Escritório Ipê',
      'escritorio.ipe',
    );
    await enrollLead(deps, sdr, { leadId });
    fake.profiles.set(igsid, { username: 'escritorio.ipe', name: 'Escritório Ipê (fictício)' });
    await deliver(
      dm(igsid, 'mid.resposta-1', 'Tenho interesse, me conta mais', '2026-10-13T11:58:00Z'),
    );

    const message = await db.message.findFirstOrThrow({
      where: { leadId, direction: 'INBOUND' },
      include: { conversation: true },
    });
    expect(message).toMatchObject({
      channel: 'INSTAGRAM',
      mode: 'API',
      status: 'RECEIVED',
      provider: 'fake',
      providerMessageId: 'mid.resposta-1',
      contactPointId,
      body: 'Tenho interesse, me conta mais',
      classification: null,
    });
    expect(message.conversation).toMatchObject({
      channel: 'INSTAGRAM',
      externalThreadId: igsid,
      handle: 'escritorio.ipe',
      profileName: 'Escritório Ipê (fictício)',
      serviceWindowExpiresAt: new Date('2026-10-14T11:58:00Z'),
    });
    const lead = await db.lead.findUniqueOrThrow({
      where: { id: leadId },
      include: { stage: true, enrollments: true },
    });
    expect(lead.stage?.key).toBe('REPLIED');
    expect(lead.enrollments[0]).toMatchObject({ status: 'STOPPED', stopReason: 'REPLIED' });
    expect(
      await db.notification.findFirstOrThrow({ where: { type: 'instagram.received' } }),
    ).toMatchObject({ userId: sdr.id, leadId });

    const job = enqueued.find((j) => j.name === 'instagram.suggest-classification');
    expect(job?.data).toEqual({ messageId: message.id });
    expect(await runInstagramSuggestClassification(deps, job!.data)).toEqual({
      status: 'suggested',
    });

    // O mesmo webhook de novo e outra entrega da mesma mensagem: nada se repete.
    await deliver(
      dm(igsid, 'mid.resposta-1', 'Tenho interesse, me conta mais', '2026-10-13T11:58:00Z'),
    );
    await deliver(
      dm(igsid, 'mid.resposta-1', 'Tenho interesse, me conta mais', '2026-10-13T11:58:00Z').replace(
        `"time":`,
        `"extra":1,"time":`,
      ),
    );
    expect(await db.message.count({ where: { leadId, direction: 'INBOUND' } })).toBe(1);
    expect(await db.webhookEvent.count()).toBe(2);

    // A próxima mensagem vem pela conversa (sem consultar o perfil); "Sair" é opt-out na hora.
    fake.profiles.clear();
    await deliver(dm(igsid, 'mid.resposta-2', 'Sair', '2026-10-13T12:00:00Z'));
    expect(
      await db.message.findFirstOrThrow({ where: { providerMessageId: 'mid.resposta-2' } }),
    ).toMatchObject({ leadId, classification: 'OPT_OUT', classificationSource: 'RULE' });
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).contactStatus).toBe(
      'OPTED_OUT',
    );
  });

  it('resposta na janela: fila, job, eco e "visto"; fora da janela e API desligada, não', async () => {
    const { leadId, contactPointId, igsid } = await leadWithInstagram(
      'Escritório Aroeira',
      'escritorio.aroeira',
    );
    // Sem mensagem do contato, a API não envia: o primeiro contato é pelo app.
    await expect(sendInstagramMessage(deps, sdr, { leadId, body: 'Olá!' })).rejects.toThrow(
      /últimas 24 h/,
    );

    await deliver(dm(igsid, 'mid.in-1', 'Oi, vi o perfil de vocês', '2026-10-13T11:50:00Z'));
    const queued = await sendInstagramMessage(deps, sdr, {
      leadId,
      body: 'Oi! Posso te explicar a parceria?',
      clientRequestId: 'pedido-ig-0001',
    });
    expect(queued).toMatchObject({ status: 'QUEUED', channel: 'INSTAGRAM', mode: 'API' });
    // Clique repetido devolve a mesma mensagem.
    expect(
      (
        await sendInstagramMessage(deps, sdr, {
          leadId,
          body: 'Oi! Posso te explicar a parceria?',
          clientRequestId: 'pedido-ig-0001',
        })
      ).id,
    ).toBe(queued.id);
    await expect(
      sendInstagramMessage(deps, sdr, { leadId, body: 'x'.repeat(1001) }),
    ).rejects.toBeTruthy();

    await runSends();
    expect(fake.sent).toEqual([
      expect.objectContaining({
        kind: 'text',
        to: igsid,
        text: 'Oi! Posso te explicar a parceria?',
      }),
    ]);
    const sent = await db.message.findUniqueOrThrow({
      where: { id: queued.id },
      include: { conversation: true },
    });
    expect(sent).toMatchObject({ status: 'SENT', contactPointId, sentAt: clockTime });
    expect(sent.conversation?.lastOutboundAt).toEqual(clockTime);

    // Eco do envio (mesmo mid) e "visto": nada duplica, a mensagem fica lida.
    await deliver(echo(igsid, sent.providerMessageId!, sent.body!, '2026-10-13T12:00:01Z'));
    await deliver(seen(igsid, sent.providerMessageId!, '2026-10-13T12:05:00Z'));
    expect(await db.message.count({ where: { leadId, direction: 'OUTBOUND' } })).toBe(1);
    expect(await db.message.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({
      status: 'READ',
      readAt: new Date('2026-10-13T12:05:00Z'),
    });

    // Na fila quando a janela fecha: falha conhecida, sem chamar a Meta.
    const late = await sendInstagramMessage(deps, sdr, { leadId, body: 'Mais uma coisa' });
    at('2026-10-14T12:00:00Z');
    await runSends();
    expect(await db.message.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: '10/2018278',
    });
    expect(fake.sent).toHaveLength(1);
    await expect(retryInstagramMessage(deps, sdr, { messageId: late.id })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    await expect(sendInstagramMessage(deps, sdr, { leadId, body: 'Oi?' })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );

    // API desligada (modo assistido).
    deps.instagram = null;
    await expect(sendInstagramMessage(deps, sdr, { leadId, body: 'Oi?' })).rejects.toThrow(
      /não está ativo/,
    );
  });

  it('falhas: contato indisponível, resultado incerto corrigido pelo eco, tentar de novo', async () => {
    const { leadId, igsid } = await leadWithInstagram('Escritório Bacuri', 'escritorio.bacuri');
    await deliver(dm(igsid, 'mid.in-1', 'Oi', '2026-10-13T11:50:00Z'));

    const unavailable = await sendInstagramMessage(deps, sdr, {
      leadId,
      body: 'Oi [fake:indisponivel]',
    });
    await runSends();
    expect(await db.message.findUniqueOrThrow({ where: { id: unavailable.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: '551',
    });
    expect(
      await db.notification.findFirstOrThrow({ where: { type: 'instagram.failed' } }),
    ).toMatchObject({ userId: sdr.id, leadId });
    // Falha conhecida: volta para a fila.
    await retryInstagramMessage(deps, sdr, { messageId: unavailable.id });
    expect((await db.message.findUniqueOrThrow({ where: { id: unavailable.id } })).status).toBe(
      'QUEUED',
    );
    enqueued.length = 0;

    const uncertain = await sendInstagramMessage(deps, sdr, {
      leadId,
      body: 'Te mando o material [fake:incerto]',
    });
    await runSends();
    expect(await db.message.findUniqueOrThrow({ where: { id: uncertain.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'TIMEOUT',
    });
    // Resultado incerto: só depois de 10 minutos e com a pessoa assumindo o risco.
    await expect(
      retryInstagramMessage(deps, sdr, { messageId: uncertain.id, confirmDuplicateRisk: true }),
    ).rejects.toThrow(/10 minutos/);

    // O eco mostra que saiu: o status é corrigido, sem duplicar.
    await deliver(
      echo(igsid, 'mid.saiu-mesmo', 'Te mando o material [fake:incerto]', '2026-10-13T12:00:02Z'),
    );
    expect(await db.message.findUniqueOrThrow({ where: { id: uncertain.id } })).toMatchObject({
      status: 'SENT',
      providerMessageId: 'mid.saiu-mesmo',
      errorCode: null,
    });
    expect(await db.message.count({ where: { leadId, direction: 'OUTBOUND' } })).toBe(2);
  });

  it('eco do que a equipe enviou pelo app: histórico da conversa; assistido ganha o id da Meta', async () => {
    const { leadId, igsid } = await leadWithInstagram('Escritório Cajá', 'escritorio.caja');
    // Conversa desconhecida (primeiro contato pelo app): o eco não grava nada.
    await deliver(echo(igsid, 'mid.app-0', 'Olá, tudo bem?', '2026-10-13T11:00:00Z'));
    expect(await db.message.count({ where: { leadId } })).toBe(0);

    await deliver(dm(igsid, 'mid.in-1', 'Oi, tudo sim', '2026-10-13T11:30:00Z'));
    await deliver(echo(igsid, 'mid.app-1', 'Que bom! Posso ligar?', '2026-10-13T11:40:00Z'));
    const history = await db.message.findFirstOrThrow({
      where: { providerMessageId: 'mid.app-1' },
    });
    expect(history).toMatchObject({
      leadId,
      direction: 'OUTBOUND',
      mode: 'ASSISTED',
      status: 'SENT',
      body: 'Que bom! Posso ligar?',
      sentAt: new Date('2026-10-13T11:40:00Z'),
    });
    expect(
      await db.leadEvent.count({ where: { leadId, type: 'message.sent', subjectId: history.id } }),
    ).toBe(1);

    // Contato assistido confirmado e o eco com o mesmo texto: só guarda o id da Meta.
    const { message: prepared } = await prepareAssistedMessage(deps, sdr, {
      leadId,
      channel: 'INSTAGRAM',
      body: 'Te ligo às 10h.',
    });
    await confirmAssistedMessage(deps, sdr, { messageId: prepared.id });
    await deliver(echo(igsid, 'mid.app-2', 'Te ligo às 10h.', '2026-10-13T12:00:00Z'));
    expect(await db.message.findUniqueOrThrow({ where: { id: prepared.id } })).toMatchObject({
      status: 'SENT',
      providerMessageId: 'mid.app-2',
    });
    expect(await db.message.count({ where: { leadId, direction: 'OUTBOUND' } })).toBe(2);
  });

  it('comentários: só de leads; resposta privada uma vez, em até 7 dias', async () => {
    const { leadId, contactPointId } = await leadWithInstagram(
      'Escritório Jatobá',
      'escritorio.jatoba',
    );
    await deliver(
      comment('escritorio.jatoba', 'comentario-1', 'Que post bom!', '2026-10-13T11:00:00Z'),
    );
    // De quem não é lead, da própria Docline e repetido: nada novo fica gravado.
    await deliver(comment('outra.pessoa', 'comentario-2', 'Legal', '2026-10-13T11:01:00Z'));
    await deliver(
      comment('docline.demo', 'comentario-3', 'Obrigado!', '2026-10-13T11:02:00Z', ACCOUNT),
    );
    await deliver(
      comment('escritorio.jatoba', 'comentario-1', 'Que post bom!', '2026-10-13T11:00:00Z').replace(
        `"time":`,
        `"extra":1,"time":`,
      ),
    );
    const comments = await db.socialComment.findMany();
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      leadId,
      contactPointId,
      externalCommentId: 'comentario-1',
      authorHandle: 'escritorio.jatoba',
      mediaProductType: 'FEED',
      body: 'Que post bom!',
    });
    const event = await db.leadEvent.findFirstOrThrow({ where: { type: 'social.comment' } });
    expect(event.payload).toEqual({ mediaProductType: 'FEED', reply: false });
    expect(
      await db.notification.findFirstOrThrow({ where: { type: 'instagram.comment' } }),
    ).toMatchObject({ userId: sdr.id, leadId });

    // Resposta privada: uma por comentário; o envio abre a conversa com quem comentou.
    const reply = await sendInstagramPrivateReply(deps, sdr, {
      commentId: comments[0]!.id,
      body: 'Obrigado! Posso te mandar mais detalhes por aqui?',
    });
    await expect(
      sendInstagramPrivateReply(deps, sdr, { commentId: comments[0]!.id, body: 'De novo' }),
    ).rejects.toThrow(/só uma/);
    await runSends();
    expect(fake.sent).toEqual([
      expect.objectContaining({ kind: 'private_reply', to: 'comentario-1' }),
    ]);
    const sent = await db.message.findUniqueOrThrow({
      where: { id: reply.id },
      include: { conversation: true },
    });
    expect(sent).toMatchObject({ status: 'SENT', mode: 'API', channel: 'INSTAGRAM' });
    expect(sent.conversation).toMatchObject({
      externalThreadId: fakeInstagramUserId('escritorio.jatoba'),
      handle: 'escritorio.jatoba',
      serviceWindowExpiresAt: null,
    });

    // Comentário antigo: a Meta não aceita mais.
    await deliver(
      comment(
        'escritorio.jatoba',
        'comentario-4',
        'Pare de me mandar mensagem',
        '2026-10-05T11:00:00Z',
      ),
    );
    const old = await db.socialComment.findFirstOrThrow({
      where: { externalCommentId: 'comentario-4' },
    });
    await expect(
      sendInstagramPrivateReply(deps, sdr, { commentId: old.id, body: 'Oi' }),
    ).rejects.toThrow(/7 dias/);
    // Pedido de opt-out num comentário público: uma pessoa confere.
    expect(
      await db.notification.count({
        where: { type: 'instagram.comment', body: { contains: 'opt-out' } },
      }),
    ).toBe(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).contactStatus).not.toBe(
      'OPTED_OUT',
    );
  });

  it('quem não é lead: lista por canal, vincular com o @ cadastrado, procurar de novo', async () => {
    await deliver(
      dm(
        fakeInstagramUserId('novo.escritorio'),
        'mid.novo',
        'Quero saber da parceria',
        '2026-10-13T11:00:00Z',
      ),
    );
    await deliver(dm('igsid-sem-perfil', 'mid.sem-perfil', 'Oi', '2026-10-13T11:05:00Z'));
    expect(
      await db.notification.count({
        where: { type: 'instagram.unmatched', userId: { in: [admin.id, manager.id] } },
      }),
    ).toBe(4);
    expect(
      await db.notification.count({ where: { type: 'instagram.unmatched', userId: sdr.id } }),
    ).toBe(0);

    await expect(listUnmatchedInbound(deps, sdr, { channel: 'INSTAGRAM' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await listUnmatchedInbound(deps, manager, {})).toEqual([]);
    const pending = await listUnmatchedInbound(deps, manager, { channel: 'INSTAGRAM' });
    expect(pending.map((p) => [p.providerMessageId, p.handle])).toEqual([
      ['mid.sem-perfil', null],
      ['mid.novo', 'novo.escritorio'],
    ]);

    // Lead sem o @: cadastre antes. Sem o @ conhecido, só "procurar de novo".
    const other = await leadWithInstagram('Escritório Pequi', 'escritorio.pequi');
    await expect(
      linkInstagramUnmatched(deps, manager, { unmatchedId: pending[1]!.id, leadId: other.leadId }),
    ).rejects.toThrow(/Cadastre o Instagram/);
    await expect(
      linkInstagramUnmatched(deps, manager, { unmatchedId: pending[0]!.id, leadId: other.leadId }),
    ).rejects.toThrow(/Procurar de novo/);
    // Os casos de uso do WhatsApp não mexem nas mensagens do Instagram.
    await expect(
      linkUnmatchedInbound(deps, manager, { unmatchedId: pending[1]!.id, leadId: other.leadId }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      retryInstagramUnmatched(deps, manager, { unmatchedId: pending[1]!.id }),
    ).rejects.toThrow(/Ainda não há lead/);
    const created = await leadWithInstagram('Novo Escritório', 'novo.escritorio');
    expect(await retryInstagramUnmatched(deps, manager, { unmatchedId: pending[1]!.id })).toEqual({
      leadId: created.leadId,
    });
    expect(
      await db.message.findFirstOrThrow({ where: { providerMessageId: 'mid.novo' } }),
    ).toMatchObject({ leadId: created.leadId, direction: 'INBOUND', mode: 'API' });

    // O perfil passou a ser conhecido na Meta: "procurar de novo" consulta e vincula.
    fake.profiles.set('igsid-sem-perfil', { username: 'escritorio.pequi', name: null });
    expect(await retryInstagramUnmatched(deps, manager, { unmatchedId: pending[0]!.id })).toEqual({
      leadId: other.leadId,
    });
    expect(await listUnmatchedInbound(deps, manager, { channel: 'INSTAGRAM' })).toEqual([]);
  });

  it('leituras, conta conectada, mesclagem e anonimização', async () => {
    const survivor = await leadWithInstagram('Escritório Ômega', 'escritorio.omega');
    const merged = await leadWithInstagram('Escritório Ômega Contábil', 'escritorio.omega');
    // Duas pessoas com o mesmo @: a conversa já existente decide o lead.
    await db.conversation.create({
      data: {
        leadId: merged.leadId,
        channel: 'INSTAGRAM',
        contactPointId: merged.contactPointId,
        externalThreadId: merged.igsid,
        handle: 'escritorio.omega',
      },
    });
    await deliver(dm(merged.igsid, 'mid.omega-1', 'Oi', '2026-10-13T11:50:00Z'));
    await deliver(
      comment('escritorio.omega', 'comentario-omega', 'Bom dia!', '2026-10-13T11:55:00Z'),
    );
    // Com o @ em dois leads, o comentário não fica em nenhum.
    expect(await db.socialComment.count()).toBe(0);
    await db.socialComment.create({
      data: {
        leadId: merged.leadId,
        contactPointId: merged.contactPointId,
        channel: 'INSTAGRAM',
        provider: 'fake',
        externalCommentId: 'comentario-antigo',
        externalUserId: merged.igsid,
        authorHandle: 'escritorio.omega',
        mediaId: 'media-1',
        commentedAt: new Date('2026-10-12T12:00:00Z'),
      },
    });

    const view = await getLeadInstagram(deps, sdr, { leadId: merged.leadId });
    expect(view).toMatchObject({
      provider: 'fake',
      gate: { allowed: true },
      profiles: [{ handle: 'escritorio.omega', usable: true, window: { open: true } }],
      messages: [{ direction: 'INBOUND', body: 'Oi' }],
      comments: [{ authorHandle: 'escritorio.omega', privateReply: { state: 'available' } }],
    });
    expect(await listInstagramConversations(deps, sdr, {})).toEqual([
      expect.objectContaining({ handle: 'escritorio.omega', awaitingReply: true }),
    ]);
    await expect(getInstagramOverview(deps, sdr, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(await getInstagramOverview(deps, admin, {})).toMatchObject({
      provider: 'fake',
      pendingUnmatched: 0,
      totals: { received: 1, comments: 1, requested: 0 },
    });
    expect(await checkInstagramAccount(deps, admin)).toMatchObject({ status: 'ACTIVE' });
    expect(
      await db.integrationConnection.findUniqueOrThrow({ where: { provider: 'instagram:fake' } }),
    ).toMatchObject({
      status: 'ACTIVE',
      config: expect.objectContaining({ username: 'docline.demo' }),
    });

    // Mesclagem: conversa e comentário passam para o sobrevivente.
    await runDuplicateScan(deps);
    const candidate = await db.duplicateCandidate.findFirstOrThrow();
    await mergeDuplicate(deps, manager, { candidateId: candidate.id, survivorId: survivor.leadId });
    expect(
      await db.conversation.findFirstOrThrow({ where: { externalThreadId: merged.igsid } }),
    ).toMatchObject({ leadId: survivor.leadId, contactPointId: survivor.contactPointId });
    expect(await db.socialComment.findFirstOrThrow()).toMatchObject({
      leadId: survivor.leadId,
      contactPointId: survivor.contactPointId,
    });

    // Anonimização: conversa, comentários, payloads e mensagens "sem lead" do titular somem.
    await db.inboundUnmatched.create({
      data: {
        channel: 'INSTAGRAM',
        provider: 'fake',
        providerMessageId: 'mid.omega-solto',
        externalThreadId: merged.igsid,
        handle: 'escritorio.omega',
        messageKind: 'text',
        body: 'Oi de novo',
        receivedAt: clockTime,
      },
    });
    expect(await db.webhookEvent.count()).toBe(2);
    await anonymizeLead(deps, admin, {
      leadId: survivor.leadId,
      reason: 'Pedido do titular (teste)',
    });
    expect(await db.conversation.count({ where: { leadId: survivor.leadId } })).toBe(0);
    expect(await db.socialComment.count()).toBe(0);
    expect(await db.webhookEvent.count()).toBe(0);
    expect(await db.inboundUnmatched.count()).toBe(0);
  });
});
