import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import {
  BusinessRuleError,
  ExternalServiceError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
} from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { anonymizeLead, createLead, registerOptOut, type CreateLeadInput } from '../leads';
import { confirmAssistedMessage, recordReply } from '../messaging';
import {
  approveGeneration,
  createApproach,
  FakeAiProvider,
  discardGeneration,
  editGeneration,
  generateOutreach,
  getAiUsage,
  listLeadGenerations,
  rateGeneration,
  suggestReplyClassification,
  upsertKnowledgeItem,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, ai, createActor } = createTestDeps();
let clockTime = new Date('2026-10-13T12:00:00Z'); // terça 09:00 em Fortaleza
deps.clock = { now: () => clockTime };
const SOBRAL = 2312908;

describe('IA de prospecção (M12, F6-03 a F6-06)', () => {
  let admin: UserActor;
  let manager: UserActor;
  let sdr: UserActor;
  let otherSdr: UserActor;
  let sourceId: string;
  let phone = 7700;

  const make = (name: string, overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    people: [{ fullName: 'Carlos Fictício Teste', isPrimary: true }],
    contactPoints: [{ type: 'PHONE', value: `(88) 99812-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
    ...overrides,
  });

  beforeEach(async () => {
    clockTime = new Date('2026-10-13T12:00:00Z');
    deps.aiLimits.maxGenerationsPerUserPerDay = 200;
    deps.aiLimits.monthlyBudgetUsd = null;
    ai.requests.length = 0;
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    manager = (await createActor('MANAGER')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
    otherSdr = (await createActor('SDR')).actor as UserActor;
  });
  afterAll(() => closeTestDb());

  it('gerar → editar → aprovar → confirmar: texto aprovado é o enviado, com contexto mínimo', async () => {
    await upsertKnowledgeItem(deps, admin, {
      key: 'parceria',
      title: 'Parceria',
      content: 'Fato fictício de teste: parceria com escritórios contábeis.',
    });
    const approach = await createApproach(deps, admin, {
      key: 'parceria-revenda',
      name: 'Parceria de revenda',
      guidance: 'Foque na parceria.',
    });
    const { id } = await createLead(deps, sdr, make('Contabilidade Ipê'));

    const draft = await generateOutreach(deps, sdr, {
      leadId: id,
      kind: 'FIRST_CONTACT',
      approachId: approach.id,
    });
    expect(draft).toMatchObject({
      status: 'GENERATED',
      kindLabel: 'Primeiro contato',
      prompt: 'outreach_message@v1',
      provider: 'fake',
      costEstimateUsd: 0,
      blocking: false,
      approach: { id: approach.id },
    });
    expect(draft.text).toContain('Olá, Carlos!');
    expect(draft.text).toContain('Se preferir não receber mensagens, é só me avisar.');

    // O que foi à IA: fatos no sistema; lead sem telefone, sem CNPJ, só o primeiro nome.
    const [request] = ai.requests;
    expect(request!.system).toContain('PARCERIA');
    expect(request!.input).toContain('"name": "Contabilidade Ipê"');
    expect(request!.input).not.toMatch(/99812|Fictício/);
    const stored = await db.aiGeneration.findUniqueOrThrow({ where: { id: draft.id } });
    expect(JSON.stringify(stored.inputSnapshot)).not.toContain('99812');
    expect(stored).toMatchObject({ inputTokens: expect.any(Number), requestedById: sdr.id });

    const edited = await editGeneration(deps, sdr, {
      generationId: draft.id,
      text: `${draft.text} Abraço!`,
    });
    expect(edited.status).toBe('EDITED');
    expect(edited.editDistanceRatio).toBeGreaterThan(0);

    const approved = await approveGeneration(deps, sdr, {
      generationId: draft.id,
      text: edited.text!,
    });
    expect(approved.generation).toMatchObject({ status: 'APPROVED', approvedBy: { id: sdr.id } });
    expect(approved.link).toContain(encodeURIComponent('Abraço!'));
    expect(approved.message).toMatchObject({
      status: 'PENDING_CONFIRMATION',
      body: edited.text,
      messageType: 'FIRST_CONTACT',
      aiGenerationId: draft.id,
      approachId: approach.id,
    });
    // Aprovado não muda mais o texto.
    await expect(
      editGeneration(deps, sdr, { generationId: draft.id, text: 'Outro texto' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    await confirmAssistedMessage(deps, sdr, { messageId: approved.message.id });
    expect(await db.aiGeneration.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: 'SENT',
      textFinal: edited.text,
    });
    await rateGeneration(deps, sdr, { generationId: draft.id, rating: 4, feedback: 'Bom.' });

    // Anonimizar apaga o contexto e os textos da geração.
    await anonymizeLead(deps, admin, { leadId: id, reason: 'Pedido do titular (teste).' });
    expect(await db.aiGeneration.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      inputSnapshot: { anonymized: true },
      output: null,
      textGenerated: null,
      textFinal: null,
      feedback: null,
    });
  });

  it('guardrail bloqueante exige editar antes de aprovar; gerar de novo descarta o anterior', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Jacarandá'));
    const draft = await generateOutreach(deps, sdr, {
      leadId: id,
      kind: 'FIRST_CONTACT',
      instructions: '[fake:termo-proibido]',
    });
    expect(draft.blocking).toBe(true);
    expect(draft.flags.map((f) => f.code)).toContain('FORBIDDEN_TERM');
    await expect(
      approveGeneration(deps, sdr, { generationId: draft.id, text: draft.text! }),
    ).rejects.toThrow(/Corrija antes de aprovar/);

    const again = await generateOutreach(deps, sdr, {
      leadId: id,
      kind: 'FIRST_CONTACT',
      replacesGenerationId: draft.id,
    });
    expect(again.blocking).toBe(false);
    expect(await db.aiGeneration.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: 'DISCARDED',
      discardReason: 'Gerada de novo.',
    });
    await discardGeneration(deps, sdr, { generationId: again.id, reason: 'Vou ligar.' });
    expect((await listLeadGenerations(deps, sdr, { leadId: id })).map((g) => g.status)).toEqual([
      'DISCARDED',
      'DISCARDED',
    ]);
    // Fora do escopo, o rascunho "não existe".
    await expect(listLeadGenerations(deps, otherSdr, { leadId: id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('gate: lead na Lista Não Contatar não gera (bloqueado, sem chamar a IA)', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Embaúba'));
    await registerOptOut(deps, sdr, { leadId: id });
    const blocked = await generateOutreach(deps, sdr, { leadId: id, kind: 'FIRST_CONTACT' });
    expect(blocked).toMatchObject({ status: 'BLOCKED', errorCode: 'GATE', blocking: true });
    expect(ai.requests).toHaveLength(0);
  });

  it('falhas do provedor ficam registradas; saída inválida tenta de novo uma vez', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Guanandi'));
    const attempt = (instructions: string) =>
      generateOutreach(deps, sdr, { leadId: id, kind: 'FIRST_CONTACT', instructions });

    await expect(attempt('[fake:recusa]')).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(attempt('[fake:indisponivel]')).rejects.toBeInstanceOf(ExternalServiceError);
    ai.requests.length = 0;
    await expect(attempt('[fake:invalido]')).rejects.toThrow(/resposta válida/);
    expect(ai.requests).toHaveLength(2);

    // Relógio fixo: todas as linhas têm o mesmo created_at; compara sem ordem.
    const rows = await db.aiGeneration.findMany({ where: { leadId: id } });
    expect(rows.map((r) => `${r.status}:${r.errorCode}`).sort()).toEqual([
      'FAILED:INVALID_OUTPUT',
      'FAILED:REFUSAL',
      'FAILED:UNAVAILABLE',
    ]);
  });

  it('cota diária por pessoa e orçamento do mês (aviso aos administradores em 80%)', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Pitanga'));
    deps.aiLimits.maxGenerationsPerUserPerDay = 2;
    await generateOutreach(deps, sdr, { leadId: id, kind: 'FIRST_CONTACT' });
    await generateOutreach(deps, sdr, { leadId: id, kind: 'FOLLOW_UP_1' });
    await expect(
      generateOutreach(deps, sdr, { leadId: id, kind: 'FOLLOW_UP_2' }),
    ).rejects.toBeInstanceOf(RateLimitError);
    // No dia seguinte, a cota volta.
    clockTime = new Date('2026-10-14T12:00:00Z');
    await generateOutreach(deps, sdr, { leadId: id, kind: 'FOLLOW_UP_2' });

    // Orçamento de US$ 1 com gasto anterior (fictício) logo abaixo de 80%.
    deps.aiLimits.maxGenerationsPerUserPerDay = 200;
    deps.aiLimits.monthlyBudgetUsd = 1;
    const previous = await db.aiGeneration.findFirstOrThrow({ where: { leadId: id } });
    await db.aiGeneration.update({
      where: { id: previous.id },
      data: { costEstimateUsd: 0.79999 },
    });
    const original = deps.ai;
    deps.ai = new FakeAiProvider({ model: 'claude-haiku-5-5' });
    try {
      const priced = await generateOutreach(deps, sdr, { leadId: id, kind: 'FOLLOW_UP_3' });
      expect(priced.costEstimateUsd).toBeGreaterThan(0);
      const alerts = await db.notification.findMany({ where: { type: 'ai.budget' } });
      expect(alerts.map((n) => n.userId)).toEqual([admin.id]);
      // Já acima de 80%: o aviso não se repete no mês.
      await generateOutreach(deps, sdr, { leadId: id, kind: 'REACTIVATION' });
      expect(await db.notification.count({ where: { type: 'ai.budget' } })).toBe(1);
    } finally {
      deps.ai = original;
    }
    await db.aiGeneration.update({ where: { id: previous.id }, data: { costEstimateUsd: 1 } });
    await expect(
      generateOutreach(deps, sdr, { leadId: id, kind: 'FIRST_CONTACT' }),
    ).rejects.toThrow(/orçamento mensal/);
  });

  it('sugestão de classificação: só sugere; a pessoa confirma', async () => {
    const { id } = await createLead(deps, sdr, make('Escritório Cajá'));
    const reply = await recordReply(deps, sdr, {
      leadId: id,
      channel: 'WHATSAPP',
      body: 'Já temos fornecedor de certificado, obrigado. Me liga no (88) 3611-0000.',
    });
    const suggestion = await suggestReplyClassification(deps, sdr, { messageId: reply.message.id });
    expect(suggestion).toMatchObject({ label: 'OBJECTION', possibleOptOut: false, flags: [] });
    const [request] = ai.requests;
    expect(request!.task).toBe('reply_classification');
    expect(request!.input).toContain('[telefone]');
    // A sugestão não classifica a mensagem.
    expect(await db.message.findUniqueOrThrow({ where: { id: reply.message.id } })).toMatchObject({
      classification: null,
    });
    // Mensagem enviada não é resposta.
    const generated = await generateOutreach(deps, sdr, { leadId: id, kind: 'OBJECTION_REPLY' });
    expect(generated.status).toBe('GENERATED');
  });

  it('base de conhecimento só pelo ADMIN; mudar o texto sobe a versão; painel de custo da gestão', async () => {
    await expect(
      upsertKnowledgeItem(deps, sdr, { key: 'X', title: 'Título', content: 'Conteúdo qualquer.' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const first = await upsertKnowledgeItem(deps, admin, {
      key: 'Certificado A1',
      title: 'Certificado',
      content: 'Fato fictício um.',
    });
    expect(first).toMatchObject({ key: 'CERTIFICADO_A1', version: 1 });
    const second = await upsertKnowledgeItem(deps, admin, {
      key: 'certificado-a1',
      title: 'Certificado',
      content: 'Fato fictício dois.',
    });
    expect(second.version).toBe(2);

    const { id } = await createLead(deps, sdr, make('Escritório Umbu'));
    const draft = await generateOutreach(deps, sdr, { leadId: id, kind: 'FIRST_CONTACT' });
    await discardGeneration(deps, sdr, { generationId: draft.id, reason: 'Muito genérica.' });
    const usage = await getAiUsage(deps, manager, {});
    expect(usage).toMatchObject({
      month: '2026-10',
      provider: 'fake',
      requests: 1,
      quality: { draftsCreated: 1, discarded: 1, approved: 0 },
      byUser: [expect.objectContaining({ userId: sdr.id, count: 1 })],
      discardReasons: [{ reason: 'Muito genérica.', count: 1 }],
    });
    await expect(getAiUsage(deps, sdr, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});
