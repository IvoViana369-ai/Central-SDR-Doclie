import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import {
  addContactPoint,
  addLeadTag,
  addNote,
  anonymizeLead,
  createLead,
  createTag,
  registerOptOut,
  setChannelPermission,
  updateLead,
  type CreateLeadInput,
} from '../leads';
import { cnpjCheckDigits } from '../normalization';
import { moveLeadStage } from '../pipeline';
import {
  getDuplicate,
  ignoreDuplicate,
  keepDuplicatesSeparate,
  listDuplicates,
  mergeDuplicate,
  requestDuplicateScan,
  runDuplicateCheck,
  runDuplicateScan,
} from '.';

const { db, deps, enqueued, createActor } = createTestDeps();

const SOBRAL = 2312908;
const FORTALEZA = 2304400;
const CNPJ_MATRIZ = '11222333000181';
const CNPJ_FILIAL = `112223330002${cnpjCheckDigits('112223330002')}`;

describe('deduplicação (M06)', () => {
  let manager: Actor;
  let managerId: string;
  let admin: Actor;
  let sdr: Actor;
  let sourceId: string;

  const make = (name: string, overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [],
    acknowledgeDuplicates: true,
    ...overrides,
  });
  const create = async (name: string, overrides: Partial<CreateLeadInput> = {}) =>
    (await createLead(deps, manager, make(name, overrides))).id;

  /** Par (sem ordem) → candidato. */
  async function candidates() {
    const rows = await db.duplicateCandidate.findMany();
    return new Map(rows.map((c) => [[c.leadAId, c.leadBId].sort().join('|'), c]));
  }
  const pairKey = (x: string, y: string) => [x, y].sort().join('|');

  beforeEach(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    ({
      actor: manager,
      user: { id: managerId },
    } = await createActor('MANAGER'));
    admin = (await createActor('ADMIN')).actor;
    sdr = (await createActor('SDR')).actor;
    enqueued.length = 0;
  });

  afterAll(() => closeTestDb());

  it('matriz de sinais: cada regra com seu peso; "Silva" × "Souza" não é duplicado', async () => {
    const alfa = await create('Contábil Alfa', {
      cnpj: CNPJ_MATRIZ,
      website: 'https://alfa-ficticio.example',
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-1001' }],
    });
    // Mesmo telefone e mesmo núcleo de nome ("alfa") na mesma cidade.
    const alfa2 = await create('Alfa Contabilidade', {
      contactPoints: [{ type: 'PHONE', value: '88 99999 1001' }],
    });
    const gama = await create('Gama Assessoria', {
      municipalityCode: FORTALEZA,
      website: 'www.alfa-ficticio.example/contato',
    });
    const filial = await create('Delta Serviços', {
      cnpj: CNPJ_FILIAL,
      municipalityCode: FORTALEZA,
    });
    const silva = await create('Contabilidade Silva');
    const souza = await create('Contabilidade Souza');
    const iota = await create('Iota', {
      municipalityCode: FORTALEZA,
      contactPoints: [{ type: 'EMAIL', value: 'ficticio.docline.teste@gmail.com' }],
    });
    const kappa = await create('Kappa', {
      municipalityCode: FORTALEZA,
      contactPoints: [{ type: 'EMAIL', value: 'ficticio.docline.teste@gmail.com' }],
    });
    const lambda = await create('Lambda', {
      contactPoints: [{ type: 'INSTAGRAM', value: '@lambda.ficticio' }],
    });
    const mi = await create('Mi', {
      municipalityCode: FORTALEZA,
      contactPoints: [{ type: 'INSTAGRAM', value: 'instagram.com/lambda.ficticio' }],
    });
    const martinelli = await create('Contabilidade Martinelli');
    const martineli = await create('Escritório Martineli');

    const summary = await runDuplicateScan(deps);
    expect(summary).toMatchObject({ pairs: 6, created: 6 });

    const found = await candidates();
    expect(found.size).toBe(6);
    const rules = (x: string, y: string) =>
      (found.get(pairKey(x, y))!.reasons as { rule: string }[]).map((r) => r.rule).sort();
    expect(rules(alfa, alfa2)).toEqual(['NAME_CITY', 'PHONE']);
    expect(found.get(pairKey(alfa, alfa2))).toMatchObject({ score: 0.92, confidence: 'HIGH' });
    expect(rules(alfa, gama)).toEqual(['WEBSITE']);
    expect(found.get(pairKey(alfa, gama))).toMatchObject({ score: 0.7, confidence: 'MEDIUM' });
    // Filial: sinalizada à parte, sempre com confiança baixa.
    expect(rules(alfa, filial)).toEqual(['CNPJ_ROOT']);
    expect(found.get(pairKey(alfa, filial))!.confidence).toBe('LOW');
    // E-mail de provedor gratuito pesa menos.
    expect(rules(iota, kappa)).toEqual(['EMAIL_FREE']);
    expect(found.get(pairKey(iota, kappa))).toMatchObject({ score: 0.5, confidence: 'LOW' });
    expect(rules(lambda, mi)).toEqual(['INSTAGRAM']);
    expect(rules(martinelli, martineli)).toEqual(['NAME_SIMILAR']);
    expect(found.has(pairKey(silva, souza))).toBe(false);
    // Os motivos nunca guardam o valor em claro.
    expect(JSON.stringify([...found.values()].map((c) => c.reasons))).not.toMatch(
      /99999-?1001|ficticio\.docline\.teste@/,
    );

    // A verificação por lead acha os mesmos pares e não muda nada.
    const all = [alfa, alfa2, gama, filial, silva, souza, iota, kappa, lambda, mi, martinelli];
    expect(await runDuplicateCheck(deps, { leadIds: [...all, martineli] })).toMatchObject({
      pairs: 6,
      created: 0,
      unchanged: 6,
    });
    expect(await db.auditLog.count({ where: { action: 'duplicate.scan_completed' } })).toBe(1);
  });

  it('cadastro, edição de identificadores e novo contato agendam a busca; outros campos não', async () => {
    const id = await create('Ômega');
    expect(enqueued.map((j) => [j.name, j.data])).toEqual([
      ['dedup.check-lead', { leadIds: [id], source: 'MANUAL' }],
    ]);
    // Enfileirado na transação do cadastro (some junto se ela for desfeita).
    expect(enqueued[0]!.options?.tx).toBeDefined();
    enqueued.length = 0;
    await updateLead(deps, manager, { leadId: id, version: 1, description: 'Só observação' });
    expect(enqueued).toHaveLength(0);
    await updateLead(deps, manager, { leadId: id, version: 2, companyName: 'Ômega Ltda' });
    await addContactPoint(deps, manager, { leadId: id, type: 'PHONE', value: '(88) 99999-2002' });
    expect(enqueued.map((j) => j.name)).toEqual(['dedup.check-lead', 'dedup.check-lead']);
  });

  it('aceite M06: "manter separados" impede que o par volte, mesmo com sinal novo', async () => {
    const a = await create('Beta', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-3003' }],
    });
    const b = await create('Beta Filho', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-3003' }],
    });
    await runDuplicateCheck(deps, { leadIds: [b] });
    const [candidate] = [...(await candidates()).values()];
    await keepDuplicatesSeparate(deps, manager, {
      candidateId: candidate!.id,
      note: 'São escritórios diferentes (sócios irmãos).',
    });

    // Novo sinal (mesmo e-mail) e nova varredura: o par continua decidido.
    for (const leadId of [a, b]) {
      await addContactPoint(deps, manager, {
        leadId,
        type: 'EMAIL',
        value: 'contato@beta-ficticio.example',
      });
    }
    await runDuplicateCheck(deps, { leadIds: [a, b] });
    await runDuplicateScan(deps);
    const after = await db.duplicateCandidate.findUniqueOrThrow({ where: { id: candidate!.id } });
    expect(after).toMatchObject({ status: 'KEPT_SEPARATE', decidedById: managerId });
    expect((await listDuplicates(deps, manager, {})).data).toHaveLength(0);
    expect(await db.auditLog.count({ where: { action: 'duplicate.keep_separate' } })).toBe(1);
    // Decisão tomada não pode ser refeita.
    await expect(
      ignoreDuplicate(deps, manager, { candidateId: candidate!.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('"ignorar por agora": o par só volta com um motivo novo', async () => {
    const a = await create('Épsilon', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-4004' }],
    });
    const b = await create('Zeta', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-4004' }],
    });
    await runDuplicateCheck(deps, { leadIds: [a] });
    const [candidate] = [...(await candidates()).values()];
    await ignoreDuplicate(deps, manager, { candidateId: candidate!.id });

    expect(await runDuplicateCheck(deps, { leadIds: [a] })).toMatchObject({ skipped: 1 });
    for (const leadId of [a, b]) {
      await addContactPoint(deps, manager, { leadId, type: 'INSTAGRAM', value: 'zeta.ficticio' });
    }
    expect(await runDuplicateCheck(deps, { leadIds: [a] })).toMatchObject({ reopened: 1 });
    const reopened = await db.duplicateCandidate.findUniqueOrThrow({
      where: { id: candidate!.id },
    });
    expect(reopened).toMatchObject({ status: 'PENDING', decidedById: null, confidence: 'HIGH' });
  });

  it('mesclar: campos escolhidos, filhos movidos, cópia guardada e nada excluído', async () => {
    const tag = await createTag(deps, manager, { name: 'Parceiro' });
    const survivor = await create('Contábil Ômega', {
      description: 'Cliente de evento',
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-5005' }],
    });
    const merged = await create('Omega Contabilidade', {
      companyName: 'Ômega Serviços Contábeis Ltda',
      cnpj: CNPJ_MATRIZ,
      people: [{ fullName: 'Maria Fictícia', roleTitle: 'Sócia' }],
      contactPoints: [
        { type: 'PHONE', value: '(88) 99999-5005', isWhatsapp: true },
        { type: 'EMAIL', value: 'financeiro@omega-ficticio.example' },
      ],
    });
    await addNote(deps, manager, { leadId: merged, body: 'Pediu retorno em novembro.' });
    await addLeadTag(deps, manager, { leadId: merged, tagId: tag.id });
    await setChannelPermission(deps, manager, {
      leadId: merged,
      channel: 'EMAIL',
      legalBasis: 'LEGITIMATE_INTEREST',
    });
    await runDuplicateCheck(deps, { leadIds: [merged] });
    const [candidate] = [...(await candidates()).values()];
    const before = {
      leads: await db.lead.count(),
      contacts: await db.contactPoint.count(),
      events: await db.leadEvent.count(),
      notes: await db.leadNote.count(),
    };

    const detail = await getDuplicate(deps, manager, { candidateId: candidate!.id });
    expect(detail.suggestedSurvivorId).toBe(survivor);
    const at = detail.leads.findIndex((l) => l.id === survivor);
    const cnpjField = detail.fields.find((f) => f.key === 'cnpj')!;
    expect(cnpjField.differs).toBe(true);
    expect(cnpjField.values[at]).toBeNull();
    expect(cnpjField.values[1 - at]).toBe('11.222.333/0001-81');
    // Padrão: CNPJ e razão social vêm do outro (vazios no sobrevivente).
    expect(detail.defaultChoices[survivor]).toMatchObject({
      cnpj: 'merged',
      companyName: 'merged',
      tradeName: 'survivor',
    });

    enqueued.length = 0;
    const result = await mergeDuplicate(deps, manager, {
      candidateId: candidate!.id,
      survivorId: survivor,
      choices: { tradeName: 'merged' },
      note: 'Mesmo escritório (cadastro em duplicidade).',
    });
    expect(result).toMatchObject({ survivorId: survivor, mergedId: merged });
    expect(result.fields.sort()).toEqual(['cnpj', 'companyName', 'tradeName']);

    const s = await db.lead.findUniqueOrThrow({
      where: { id: survivor },
      include: {
        contactPoints: true,
        people: true,
        origins: true,
        tags: true,
        notes: true,
        permissions: true,
      },
    });
    expect(s).toMatchObject({
      tradeName: 'Omega Contabilidade',
      displayName: 'Omega Contabilidade',
      companyName: 'Ômega Serviços Contábeis Ltda',
      cnpj: CNPJ_MATRIZ,
      description: 'Cliente de evento',
      status: 'ACTIVE',
      version: 2,
    });
    // O telefone repetido fica um só (e herda o WhatsApp); o e-mail novo veio.
    expect(
      s.contactPoints.map((c) => [c.type, c.valueNormalized, c.whatsappStatus]).sort(),
    ).toEqual([
      ['EMAIL', 'financeiro@omega-ficticio.example', 'UNKNOWN'],
      ['PHONE', '+5588999995005', 'PROBABLE'],
    ]);
    expect(s.contactPoints.filter((c) => c.isPrimary)).toHaveLength(2);
    expect(s.people.map((p) => p.fullName)).toEqual(['Maria Fictícia']);
    expect(s.origins).toHaveLength(2);
    expect(s.origins.filter((o) => o.isFirstTouch)).toHaveLength(1);
    expect(s.tags.map((t) => t.tagId)).toEqual([tag.id]);
    expect(s.notes.map((n) => n.body)).toEqual(['Pediu retorno em novembro.']);
    expect(s.permissions.map((p) => p.channel).sort()).toEqual(['ALL', 'EMAIL']);
    expect(s.hasWhatsapp).toBe(true);

    const m = await db.lead.findUniqueOrThrow({
      where: { id: merged },
      include: { contactPoints: true, events: true },
    });
    expect(m).toMatchObject({ status: 'MERGED', mergedIntoId: survivor });
    // Só o telefone repetido ficou no mesclado; a timeline dele foi para o sobrevivente.
    expect(m.contactPoints.map((c) => c.valueNormalized)).toEqual(['+5588999995005']);
    expect(m.events.map((e) => e.type)).toEqual(['lead.merged_into']);

    // Nada foi excluído: só eventos novos (mesclado e mesclado em).
    expect({
      leads: await db.lead.count(),
      contacts: await db.contactPoint.count(),
      events: await db.leadEvent.count(),
      notes: await db.leadNote.count(),
    }).toEqual({ ...before, events: before.events + 2 });

    const record = await db.leadMerge.findFirstOrThrow();
    expect(record).toMatchObject({ survivorLeadId: survivor, mergedLeadId: merged });
    const snapshot = record.mergedSnapshot as {
      lead: { displayName: string; cnpj: string };
      moved: Record<string, string[]>;
    };
    expect(snapshot.lead).toMatchObject({ displayName: 'Omega Contabilidade', cnpj: CNPJ_MATRIZ });
    expect(snapshot.moved.notes).toHaveLength(1);
    expect(
      await db.duplicateCandidate.findUniqueOrThrow({ where: { id: candidate!.id } }),
    ).toMatchObject({
      status: 'MERGED',
      decisionNote: 'Mesmo escritório (cadastro em duplicidade).',
    });
    expect(
      await db.auditLog.count({ where: { action: { in: ['lead.merge', 'lead.merged_into'] } } }),
    ).toBe(2);
    const merge = await db.auditLog.findFirstOrThrow({ where: { action: 'lead.merge' } });
    // CNPJ mascarado na auditoria.
    expect(JSON.stringify(merge.changes)).not.toContain(CNPJ_MATRIZ);
    expect(enqueued.map((j) => [j.name, j.data])).toEqual([
      ['dedup.check-lead', { leadIds: [survivor], source: 'MANUAL' }],
    ]);
  });

  it('mesclagem: Não Contatar do lead e decisões anteriores passam para o sobrevivente', async () => {
    const survivor = await create('Teta', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-6006' }],
    });
    const merged = await create('Teta Contábil', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-6006' }],
    });
    const other = await create('Teta Matriz', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-6006' }],
    });
    await registerOptOut(deps, manager, { leadId: merged });
    await runDuplicateScan(deps);
    const found = await candidates();
    await keepDuplicatesSeparate(deps, manager, {
      candidateId: found.get(pairKey(merged, other))!.id,
    });
    await ignoreDuplicate(deps, manager, { candidateId: found.get(pairKey(survivor, other))!.id });

    await mergeDuplicate(deps, manager, {
      candidateId: found.get(pairKey(survivor, merged))!.id,
      survivorId: survivor,
    });
    expect(
      await db.suppressionEntry.count({
        where: { type: 'LEAD', valueHash: survivor, revokedAt: null },
      }),
    ).toBe(1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: survivor } })).contactStatus).toBe(
      'OPTED_OUT',
    );
    // O par sobrevivente × outro já tinha decisão própria (ignorado): ela prevalece.
    const pair = (await candidates()).get(pairKey(survivor, other))!;
    expect(pair.status).toBe('IGNORED');
  });

  it('regras de acesso e conflitos da mesclagem', async () => {
    const a = await create('Iota Contábil', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-7007' }],
    });
    const b = await create('Iota', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-7007' }],
    });
    const c = await create('Capa');
    await runDuplicateCheck(deps, { leadIds: [a] });
    const [candidate] = [...(await candidates()).values()];

    await expect(listDuplicates(deps, sdr, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      mergeDuplicate(deps, sdr, { candidateId: candidate!.id, survivorId: a }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestDuplicateScan(deps, sdr, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      mergeDuplicate(deps, manager, { candidateId: candidate!.id, survivorId: c }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      mergeDuplicate(deps, manager, {
        candidateId: candidate!.id,
        survivorId: a,
        versions: { survivor: 1, merged: 99 },
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await mergeDuplicate(deps, manager, { candidateId: candidate!.id, survivorId: b });
    await expect(
      mergeDuplicate(deps, manager, { candidateId: candidate!.id, survivorId: b }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    // O mesclado não pode mais ser editado.
    await expect(
      updateLead(deps, manager, { leadId: a, version: 2, description: 'x' }),
    ).rejects.toBeInstanceOf(ConflictError);

    enqueued.length = 0;
    expect(await requestDuplicateScan(deps, admin, {})).toMatchObject({ queued: true });
    expect(enqueued.map((j) => j.name)).toEqual(['dedup.scan']);
    expect(await db.auditLog.count({ where: { action: 'duplicate.scan_requested' } })).toBe(1);
  });

  it('fila: filtros por confiança e motivo, contagens e paginação', async () => {
    await create('Rômulo', { contactPoints: [{ type: 'PHONE', value: '(88) 99999-8008' }] });
    await create('Rômulo Assessoria', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-8008' }],
    });
    await create('Sigma', { website: 'https://sigma-ficticio.example' });
    await create('Tau', { website: 'https://sigma-ficticio.example', municipalityCode: FORTALEZA });
    await create('Contabilidade Upsilon');
    await create('Ípsilon Upsilon Contadores', { municipalityCode: SOBRAL });
    await runDuplicateScan(deps);

    const first = await listDuplicates(deps, manager, { limit: 2 });
    expect(first.counts).toEqual({ HIGH: 1, MEDIUM: 1, LOW: 1 });
    expect(first.data.map((d) => d.confidence)).toEqual(['HIGH', 'MEDIUM']);
    expect(first.data[0]!.reasons.map((r) => r.label).sort()).toEqual([
      'Mesmo nome na mesma cidade',
      'Mesmo telefone',
    ]);
    expect(first.nextCursor).toBe(2);
    const second = await listDuplicates(deps, manager, { limit: 2, cursor: 2 });
    expect(second.data.map((d) => d.reasons[0]!.rule)).toEqual(['NAME_SIMILAR']);
    expect(second.nextCursor).toBeNull();
    const bySite = await listDuplicates(deps, manager, { rule: 'WEBSITE' });
    expect(bySite.data.map((d) => d.leads.map((l) => l.displayName).sort())).toEqual([
      ['Sigma', 'Tau'],
    ]);
    expect((await listDuplicates(deps, manager, { confidence: 'HIGH' })).data).toHaveLength(1);
  });

  it('mesclagem: a etapa escolhida do outro lead entra pelo pipeline, com histórico', async () => {
    const survivor = await create('Ômicron', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99812-5101' }],
    });
    const merged = await create('Ômicron Contábil', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99812-5101' }],
    });
    const qualified = await db.pipelineStage.findFirstOrThrow({ where: { key: 'QUALIFIED' } });
    await moveLeadStage(deps, manager, { leadId: merged, stageId: qualified.id, version: 1 });
    await runDuplicateCheck(deps, { leadIds: [merged] });
    const [candidate] = [...(await candidates()).values()];

    const detail = await getDuplicate(deps, manager, { candidateId: candidate!.id });
    expect(detail.fields.find((f) => f.key === 'stage')).toMatchObject({ differs: true });
    await mergeDuplicate(deps, manager, {
      candidateId: candidate!.id,
      survivorId: survivor,
      choices: { stage: 'merged' },
    });
    const s = await db.lead.findUniqueOrThrow({
      where: { id: survivor },
      include: { stage: true, stageHistory: { orderBy: { enteredAt: 'asc' } } },
    });
    expect(s.stage?.key).toBe('QUALIFIED');
    expect(s.stageHistory.at(-1)).toMatchObject({ automationSource: 'MERGE', leftAt: null });
    // O mesclado sai do funil: nenhuma passagem aberta.
    expect(await db.leadStageHistory.count({ where: { leadId: merged, leftAt: null } })).toBe(0);
  });

  it('anonimizar o sobrevivente apaga também os dados do lead mesclado nele', async () => {
    const survivor = await create('Fi', {
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-9009' }],
    });
    const merged = await create('Fi Contábil', {
      description: 'Contato da recepção',
      contactPoints: [{ type: 'PHONE', value: '(88) 99999-9009' }],
    });
    await db.lead.update({
      where: { id: merged },
      data: { customFields: { responsavel: 'Fulano Fictício' } },
    });
    await runDuplicateCheck(deps, { leadIds: [merged] });
    const [candidate] = [...(await candidates()).values()];
    await mergeDuplicate(deps, manager, { candidateId: candidate!.id, survivorId: survivor });

    await anonymizeLead(deps, admin, { leadId: survivor, reason: 'Pedido do titular (teste).' });
    const m = await db.lead.findUniqueOrThrow({
      where: { id: merged },
      include: { contactPoints: true },
    });
    expect(m).toMatchObject({ status: 'MERGED', description: null, customFields: null });
    expect(m.displayName).toMatch(/^Lead anonimizado L-/);
    expect(m.anonymizedAt).not.toBeNull();
    expect(m.contactPoints.every((c) => c.valueRaw === '' && c.status === 'REMOVED')).toBe(true);
    const record = await db.leadMerge.findFirstOrThrow();
    expect(record.mergedSnapshot).toEqual({ anonymized: true });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lead.anonymize' } });
    expect((audit.metadata as { mergedLeads: string[] }).mergedLeads).toHaveLength(1);
  });
});
