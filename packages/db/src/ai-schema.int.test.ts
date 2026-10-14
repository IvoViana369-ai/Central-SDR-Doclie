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

const generation = (leadId: string, extra: Record<string, unknown> = {}) =>
  db.aiGeneration.create({
    data: {
      leadId,
      kind: 'FIRST_CONTACT',
      promptId: 'outreach_message',
      promptVersion: 1,
      provider: 'fake',
      model: 'fake-model',
      params: { effort: 'medium' },
      inputSnapshot: { lead: { name: 'Escritório Fictício' } },
      status: 'GENERATED',
      ...extra,
    },
  });

describe('schema da IA (garantias no banco)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('um envio ativo por rascunho; abordagem removida não apaga o histórico', async () => {
    const lead = await createLead('Escritório IA');
    const approach = await db.approach.create({ data: { key: 'PARCERIA', name: 'Parceria' } });
    const draft = await generation(lead.id, { approachId: approach.id });
    expect(draft.guardrailFlags).toEqual([]);

    const message = {
      leadId: lead.id,
      channel: 'WHATSAPP' as const,
      direction: 'OUTBOUND' as const,
      mode: 'ASSISTED' as const,
      status: 'PENDING_CONFIRMATION' as const,
      aiGenerationId: draft.id,
      approachId: approach.id,
    };
    const first = await db.message.create({ data: message });
    // O mesmo rascunho não vira dois envios ao mesmo tempo…
    await expect(db.message.create({ data: message })).rejects.toThrow();
    // …mas, cancelado o primeiro, pode ser preparado de novo.
    await db.message.update({ where: { id: first.id }, data: { status: 'CANCELED' } });
    await db.message.create({ data: message });

    await db.approach.delete({ where: { id: approach.id } });
    expect(await db.aiGeneration.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      approachId: null,
    });
    const messages = await db.message.findMany({ where: { leadId: lead.id } });
    expect(messages.map((m) => [m.approachId, m.aiGenerationId])).toEqual([
      [null, draft.id],
      [null, draft.id],
    ]);
  });

  it('sugestão de classificação aponta a resposta; chaves únicas na base de conhecimento', async () => {
    const lead = await createLead('Escritório Resposta');
    const inbound = await db.message.create({
      data: {
        leadId: lead.id,
        channel: 'WHATSAPP',
        direction: 'INBOUND',
        mode: 'LOGGED',
        status: 'RECEIVED',
        body: 'Quanto custa?',
      },
    });
    await generation(lead.id, { kind: 'REPLY_CLASSIFICATION', sourceMessageId: inbound.id });
    const withSuggestions = await db.message.findUniqueOrThrow({
      where: { id: inbound.id },
      include: { aiClassifications: true },
    });
    expect(withSuggestions.aiClassifications).toHaveLength(1);

    await db.aiKnowledgeItem.create({
      data: { key: 'PARCERIA', title: 'Parceria', content: 'Fato fictício de teste.' },
    });
    await expect(
      db.aiKnowledgeItem.create({ data: { key: 'PARCERIA', title: 'Outro', content: 'x' } }),
    ).rejects.toThrow();
  });
});
