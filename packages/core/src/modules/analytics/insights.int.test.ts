import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiProviderError, type AiProvider } from '../../ports/ai';
import type { Actor } from '../../shared/actor';
import { ForbiddenError, NotFoundError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { createLead, type CreateLeadInput } from '../leads';
import { logOutboundMessage, recordReply } from '../messaging';
import { handoffToSales } from '../opportunities';
import { generateInsights, getInsights, rateInsight, runAnalyticsRollup, runInsightsJob } from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, createActor } = createTestDeps();
const fakeAi = deps.ai;
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça, 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const at = (iso: string) => {
  clockTime = new Date(iso);
};
const SOBRAL = 2312908;
const QUALIFICATION = {
  decisionMaker: 'Sócia fictícia — contadora responsável',
  interest: 'Quer oferecer certificado digital aos clientes do escritório.',
  bestChannelAndTime: 'WhatsApp, manhãs',
  clientCount: 120,
};

/** IA de teste que devolve textos escolhidos (para conferir a validação). */
function scriptedAi(texts: Record<string, string>): AiProvider {
  return {
    name: 'fake',
    models: { generation: 'fake-sdr', classification: 'fake-sdr' },
    async generateStructured(request) {
      const data = request.schema.parse({
        insights: Object.entries(texts).map(([type, text]) => ({ type, text })),
      });
      return {
        data,
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
        model: 'fake-sdr',
        latencyMs: 1,
        stopReason: 'end_turn',
        fallbackUsed: false,
      };
    },
  };
}

/**
 * Cenário fictício (Sobral/CE), carteira do SDR A:
 * - L1 respondeu depois do contato (espera ação);
 * - L2 prioritário sem contato;
 * - L3 sem atividade há 10 dias (esquecido);
 * - L4 transferido ao Comercial há 6 dias, sem aceite.
 * Equipe: 40 leads do SDR B com 1º contato nos últimos 90 dias; 20 com a
 * abordagem "Parceria" (15 responderam) e 20 sem abordagem (2 responderam);
 * com L1, a média geral é 18 de 41 (43,9%).
 * Base aberta do CNPJ: 5 escritórios em Sobral, 1 deles já é lead.
 */
describe('insights da carteira (F11-04)', () => {
  let manager: UserActor;
  let sdrA: UserActor;
  let sdrB: UserActor;
  let sales: UserActor;
  let sourceId: string;
  let seq = 0;

  const make = (name: string): CreateLeadInput => {
    seq += 1;
    return {
      tradeName: name,
      municipalityCode: SOBRAL,
      origin: { sourceId, collectedAt: '2026-09-01' },
      legalBasis: 'LEGITIMATE_INTEREST',
      contactPoints: [{ type: 'PHONE', value: `(88) 99815-${3300 + seq}`, isWhatsapp: true }],
      acknowledgeDuplicates: true,
    };
  };

  beforeAll(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdrA = (await createActor('SDR')).actor as UserActor;
    sdrB = (await createActor('SDR')).actor as UserActor;
    sales = (await createActor('SALES')).actor as UserActor;
    await db.userTerritory.create({
      data: { userId: sdrA.id, stateUf: 'CE', municipalityCode: SOBRAL },
    });

    at('2026-10-07T12:00:00Z'); // quarta-feira
    const l1 = await createLead(deps, sdrA, make('Escritório Juazeiro'));
    await logOutboundMessage(deps, sdrA, {
      leadId: l1.id,
      channel: 'WHATSAPP',
      body: 'Olá!',
      sentAt: '2026-10-07T12:00:00Z',
    });
    at('2026-10-08T13:00:00Z');
    await recordReply(deps, sdrA, {
      leadId: l1.id,
      channel: 'WHATSAPP',
      body: 'Pode me explicar melhor?',
      receivedAt: '2026-10-08T12:00:00Z',
    });
    const l2 = await createLead(deps, sdrA, make('Escritório Pau-Brasil'));
    await db.lead.update({ where: { id: l2.id }, data: { scoreBand: 'PRIORITY', score: 95 } });
    const l3 = await createLead(deps, sdrA, make('Escritório Ipê'));
    await db.lead.update({
      where: { id: l3.id },
      data: { lastActivityAt: new Date('2026-10-03T12:00:00Z'), nextActionAt: null },
    });
    const l4 = await createLead(deps, sdrA, make('Escritório Cedro'));
    await handoffToSales(deps, sdrA, {
      leadId: l4.id,
      salesOwnerId: sales.id,
      qualification: QUALIFICATION,
    });

    // Equipe: abordagem "Parceria" responde bem acima da média (direto no banco).
    const approach = await db.approach.create({ data: { key: 'F11_INS', name: 'Parceria' } });
    for (let i = 0; i < 40; i++) {
      const firstContactAt = new Date(Date.UTC(2026, 8, 20 + (i % 10), 13));
      const lead = await db.lead.create({
        data: {
          displayName: `Escritório Coorte ${i}`,
          nameSearch: `escritorio coorte ${i}`,
          nameCore: `coorte ${i}`,
          originSourceId: sourceId,
          collectedAt: firstContactAt,
          ownerId: sdrB.id,
          firstContactAt,
          lastActivityAt: clockTime,
          isTestData: true,
        },
      });
      const withApproach = i < 20;
      await db.message.create({
        data: {
          leadId: lead.id,
          channel: 'WHATSAPP',
          direction: 'OUTBOUND',
          mode: 'ASSISTED',
          status: 'SENT',
          sentAt: firstContactAt,
          sentById: sdrB.id,
          approachId: withApproach ? approach.id : null,
        },
      });
      if ((withApproach && i < 15) || (!withApproach && i < 22)) {
        await db.message.create({
          data: {
            leadId: lead.id,
            channel: 'WHATSAPP',
            direction: 'INBOUND',
            mode: 'ASSISTED',
            status: 'RECEIVED',
            receivedAt: new Date(firstContactAt.getTime() + 86_400_000),
          },
        });
      }
    }

    // Base aberta do CNPJ (fictícia): 5 escritórios em Sobral.
    for (let i = 0; i < 5; i++) {
      const cnpj = `9900000${i}000190`.slice(0, 14);
      await db.registryCompany.create({
        data: {
          cnpj,
          cnpjRoot: cnpj.slice(0, 8),
          isHeadOffice: true,
          nameSearch: `contabilidade ficticia ${i}`,
          cnaeMain: '6920601',
          municipalityCode: SOBRAL,
          receitaMunicipalityCode: 1559,
          uf: 'CE',
          datasetReference: '2026-09',
          ingestedAt: clockTime,
        },
      });
      if (i === 0) await db.lead.update({ where: { id: l2.id }, data: { cnpj } });
    }

    at('2026-10-13T12:00:00Z');
    await runAnalyticsRollup(deps);
  });
  afterAll(() => closeTestDb());

  it('equipe: fatos do SQL, redigidos pela IA (provedor simulado), com custo registrado', async () => {
    const summary = await generateInsights(deps, manager, { scope: 'TEAM' });
    expect(summary).toMatchObject({ scope: 'TEAM', count: 6, fromAi: 6, rejected: 0 });

    const view = await getInsights(deps, manager, {});
    expect(view).toMatchObject({ scope: 'TEAM', canRefresh: true });
    expect(view.items.map((i) => [i.type, i.source])).toEqual([
      ['AWAITING_ACTION', 'AI'],
      ['PENDING_ACCEPTANCE', 'AI'],
      ['PRIORITY_TO_CONTACT', 'AI'],
      ['FORGOTTEN_IN_CITY', 'AI'],
      ['BEST_APPROACH', 'AI'],
      ['TOP_POTENTIAL_CITY', 'AI'],
    ]);
    const texts = view.items.map((i) => i.text);
    expect(texts).toContain('1 lead respondeu e espera uma ação.');
    expect(texts).toContain('1 lead de Sobral/CE está sem follow-up há mais de 7 dias.');
    expect(texts).toContain(
      'A abordagem "Parceria" teve 75% de resposta, acima da média de 43,9% (20 primeiros contatos em 90 dias).',
    );
    expect(texts).toContain(
      'Sobral/CE tem 4 escritórios ativos que ainda não são leads (de 5 na base aberta do CNPJ).',
    );

    const generation = await db.aiGeneration.findFirstOrThrow({ where: { kind: 'INSIGHT' } });
    expect(generation).toMatchObject({
      leadId: null,
      requestedById: manager.id,
      status: 'GENERATED',
      promptId: 'portfolio_insights',
    });
    // Nenhum dado pessoal no pedido: só contagens, cidade e abordagem.
    expect(JSON.stringify(generation.inputSnapshot)).not.toMatch(/Escritório|99815/);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'insight.generate' } });
    expect(audit.metadata).toMatchObject({ scope: 'TEAM', count: 6, fromAi: 6 });
  });

  it('carteira do SDR: só os próprios números e o potencial do seu território', async () => {
    const summary = await generateInsights(deps, manager, { scope: 'USER', userId: sdrA.id });
    expect(summary.count).toBe(6);
    const mine = await getInsights(deps, sdrA, { userId: sdrB.id });
    expect(mine).toMatchObject({ scope: 'USER', userId: sdrA.id, canRefresh: false });
    expect(mine.items.map((i) => i.type)).toContain('TOP_POTENTIAL_CITY');

    // O SDR B não tem território (sem potencial) nem pendências.
    await generateInsights(deps, manager, { scope: 'USER', userId: sdrB.id });
    const theirs = await getInsights(deps, manager, { userId: sdrB.id });
    expect(theirs.items.map((i) => i.type)).toEqual(['BEST_APPROACH']);

    await expect(generateInsights(deps, sdrA, { scope: 'TEAM' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('texto da IA com número errado, telefone ou faltando: vale o texto padrão', async () => {
    deps.ai = scriptedAi({
      AWAITING_ACTION: '3 leads responderam e esperam uma ação.',
      PENDING_ACCEPTANCE: 'Ligue para (88) 99999-0000: 1 transferência sem aceite.',
      PRIORITY_TO_CONTACT: 'Há 1 escritório prioritário esperando o primeiro contato hoje.',
    });
    try {
      const summary = await generateInsights(deps, manager, { scope: 'TEAM' });
      expect(summary).toMatchObject({ count: 6, fromAi: 1, rejected: 5 });
    } finally {
      deps.ai = fakeAi;
    }
    const view = await getInsights(deps, manager, {});
    const byType = Object.fromEntries(view.items.map((i) => [i.type, i]));
    expect(byType.AWAITING_ACTION).toMatchObject({
      source: 'TEMPLATE',
      text: '1 lead respondeu e espera uma ação.',
    });
    expect(byType.PENDING_ACCEPTANCE!.source).toBe('TEMPLATE');
    expect(byType.PRIORITY_TO_CONTACT).toMatchObject({
      source: 'AI',
      text: 'Há 1 escritório prioritário esperando o primeiro contato hoje.',
    });
    const generation = await db.aiGeneration.findFirstOrThrow({
      where: { kind: 'INSIGHT' },
      // Mesmo instante (relógio parado): o id (uuid v7) desempata.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(generation.guardrailFlags).toEqual(
      expect.arrayContaining([
        { type: 'AWAITING_ACTION', reason: 'número fora dos fatos: 3' },
        { type: 'PENDING_ACCEPTANCE', reason: 'contato ou link' },
        { type: 'BEST_APPROACH', reason: 'ausente' },
      ]),
    );
    // O lote novo substitui o anterior: só 6 vigentes.
    expect(view.items).toHaveLength(6);
  });

  it('IA indisponível ou orçamento esgotado: insights saem com o texto padrão', async () => {
    deps.ai = {
      ...fakeAi,
      name: 'fake',
      models: fakeAi.models,
      async generateStructured() {
        throw new AiProviderError('UNAVAILABLE', 'Provedor de IA indisponível.', {
          model: 'fake-sdr',
        });
      },
    };
    try {
      expect(await generateInsights(deps, manager, { scope: 'TEAM' })).toMatchObject({
        count: 6,
        fromAi: 0,
        aiError: 'UNAVAILABLE',
      });
    } finally {
      deps.ai = fakeAi;
    }
    const failed = await db.aiGeneration.findFirstOrThrow({
      where: { kind: 'INSIGHT' },
      // Mesmo instante (relógio parado): o id (uuid v7) desempata.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'UNAVAILABLE' });

    const before = await db.aiGeneration.count({ where: { kind: 'INSIGHT' } });
    deps.aiLimits = { ...deps.aiLimits, monthlyBudgetUsd: 0 };
    try {
      const summary = await generateInsights(deps, manager, { scope: 'TEAM' });
      expect(summary).toMatchObject({ count: 6, fromAi: 0 });
      expect(summary.skipped).toContain('orçamento');
    } finally {
      deps.aiLimits = { ...deps.aiLimits, monthlyBudgetUsd: null };
    }
    // Sem orçamento, a IA nem é chamada.
    expect(await db.aiGeneration.count({ where: { kind: 'INSIGHT' } })).toBe(before);
    const view = await getInsights(deps, manager, {});
    expect(view.items.every((i) => i.source === 'TEMPLATE')).toBe(true);
  });

  it('avaliação: cada um avalia o que vê', async () => {
    const team = await getInsights(deps, manager, {});
    const own = await getInsights(deps, sdrA, {});
    await expect(
      rateInsight(deps, sdrA, { insightId: team.items[0]!.id, feedback: 'USEFUL' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await rateInsight(deps, sdrA, { insightId: own.items[0]!.id, feedback: 'NOT_USEFUL' }),
    ).toMatchObject({ feedback: 'NOT_USEFUL' });
    await rateInsight(deps, manager, { insightId: team.items[0]!.id, feedback: 'USEFUL' });
    expect(await db.insight.findUniqueOrThrow({ where: { id: team.items[0]!.id } })).toMatchObject({
      feedback: 'USEFUL',
      feedbackById: manager.id,
    });
  });

  it('job diário: equipe e cada SDR ativo; apaga os antigos', async () => {
    await db.insight.create({
      data: {
        generatedAt: new Date('2026-03-01T10:00:00Z'),
        validUntil: new Date('2026-03-02T10:00:00Z'),
        scope: 'TEAM',
        type: 'AWAITING_ACTION',
        text: '2 leads responderam e esperam uma ação.',
        data: { type: 'AWAITING_ACTION', count: 2 },
        source: 'TEMPLATE',
      },
    });
    at('2026-10-14T10:05:00Z');
    const result = await runInsightsJob(deps);
    expect(result).toMatchObject({ audiences: 3, errors: 0, purged: 1 });
    expect((await getInsights(deps, sdrA, {})).generatedAt).toEqual(clockTime);
    at('2026-10-13T12:00:00Z');
  });
});
