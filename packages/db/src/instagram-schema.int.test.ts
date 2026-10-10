import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

const db = getTestDb();
const now = new Date('2026-10-13T12:00:00Z');

async function createLead(name: string) {
  const source = await db.leadSource.findUniqueOrThrow({ where: { key: 'INSTAGRAM' } });
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

async function createInstagram(leadId: string, handle: string) {
  return db.contactPoint.create({
    data: {
      leadId,
      type: 'INSTAGRAM',
      valueRaw: `@${handle}`,
      valueNormalized: handle,
      valueHash: `hash-${handle}`,
    },
  });
}

describe('schema do Instagram (garantias no banco)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('uma consulta de perfil por contato; vai junto com o contato e some com ele', async () => {
    const lead = await createLead('Escritório Perfil');
    const other = await createLead('Escritório Destino');
    const point = await createInstagram(lead.id, 'escritorio.perfil');
    const profile = {
      contactPointId: point.id,
      handle: 'escritorio.perfil',
      status: 'FOUND' as const,
      followersCount: 1200,
      mediaCount: 85,
      lastPostAt: new Date('2026-10-01T15:00:00Z'),
      checkedAt: now,
    };
    await db.instagramProfile.create({ data: profile });
    await expect(db.instagramProfile.create({ data: profile })).rejects.toThrow();

    // Mesclagem: o contato muda de lead e a consulta continua valendo para ele.
    await db.contactPoint.update({ where: { id: point.id }, data: { leadId: other.id } });
    const moved = await db.contactPoint.findUniqueOrThrow({
      where: { id: point.id },
      select: { leadId: true, instagramProfile: { select: { followersCount: true } } },
    });
    expect(moved).toEqual({ leadId: other.id, instagramProfile: { followersCount: 1200 } });

    await db.contactPoint.delete({ where: { id: point.id } });
    expect(await db.instagramProfile.count()).toBe(0);
  });

  it('comentário: um registro por comentário e no máximo uma resposta privada', async () => {
    const lead = await createLead('Escritório Comentário');
    const point = await createInstagram(lead.id, 'escritorio.comentario');
    const comment = {
      leadId: lead.id,
      contactPointId: point.id,
      channel: 'INSTAGRAM' as const,
      provider: 'fake',
      externalCommentId: 'comment-1',
      externalUserId: 'igsid-1',
      authorHandle: 'escritorio.comentario',
      mediaId: 'media-1',
      mediaProductType: 'FEED',
      body: 'Quero saber mais (fictício)',
      commentedAt: now,
    };
    const created = await db.socialComment.create({ data: comment });
    await expect(db.socialComment.create({ data: comment })).rejects.toThrow();

    const reply = await db.message.create({
      data: {
        leadId: lead.id,
        contactPointId: point.id,
        channel: 'INSTAGRAM',
        direction: 'OUTBOUND',
        mode: 'API',
        body: 'Olá! Respondemos por aqui (fictício).',
        status: 'SENT',
        sentAt: now,
      },
    });
    await db.socialComment.update({
      where: { id: created.id },
      data: { privateReplyMessageId: reply.id },
    });
    const second = await db.socialComment.create({
      data: { ...comment, externalCommentId: 'comment-2' },
    });
    // A mesma mensagem não responde dois comentários.
    await expect(
      db.socialComment.update({
        where: { id: second.id },
        data: { privateReplyMessageId: reply.id },
      }),
    ).rejects.toThrow();

    // Apagar o lead apaga os comentários dele.
    await db.message.deleteMany({ where: { leadId: lead.id } });
    await db.lead.delete({ where: { id: lead.id } });
    expect(await db.socialComment.count()).toBe(0);
  });

  it('conversa e mensagem sem lead guardam o @ de quem escreveu', async () => {
    const lead = await createLead('Escritório Conversa');
    const point = await createInstagram(lead.id, 'escritorio.conversa');
    const conversation = await db.conversation.create({
      data: {
        leadId: lead.id,
        channel: 'INSTAGRAM',
        contactPointId: point.id,
        externalThreadId: 'igsid-2',
        handle: 'escritorio.conversa',
        lastInboundAt: now,
      },
    });
    expect(conversation.handle).toBe('escritorio.conversa');

    const unmatched = await db.inboundUnmatched.create({
      data: {
        channel: 'INSTAGRAM',
        provider: 'fake',
        providerMessageId: 'mid-1',
        externalThreadId: 'igsid-3',
        handle: 'perfil.desconhecido',
        messageKind: 'text',
        body: 'Olá (fictício)',
        receivedAt: now,
      },
    });
    expect(unmatched).toMatchObject({ handle: 'perfil.desconhecido', phoneE164: null });
  });
});
