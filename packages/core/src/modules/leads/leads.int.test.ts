import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors';
import { systemActor } from '../../shared/actor';
import { createTestDeps } from '../../testing/test-deps';
import {
  addContactPoint,
  addLeadTag,
  addNote,
  addPerson,
  archiveLead,
  assignLead,
  checkDuplicates,
  claimLead,
  createLead,
  createTag,
  getLead,
  listLeadHistory,
  listLeadTimeline,
  PossibleDuplicateError,
  removeContactPoint,
  removeNote,
  setUserTerritories,
  unarchiveLead,
  updateContactPoint,
  updateLead,
  type CreateLeadInput,
} from '.';

const { db, deps, createActor } = createTestDeps();
const SOBRAL = 2312908; // CE, DDD 88
const SAO_PAULO = 3550308; // SP, DDD 11

let googleSourceId: string;
let thirdPartySourceId: string;

async function leadInput(overrides: Partial<CreateLeadInput> = {}): Promise<CreateLeadInput> {
  return {
    tradeName: 'Contábil Exemplo',
    municipalityCode: SOBRAL,
    origin: { sourceId: googleSourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: '+55 88 99999-0001', isWhatsapp: true }],
    ...overrides,
  };
}

async function expectError<T extends Error>(
  promise: Promise<unknown>,
  type: new (...a: never[]) => T,
) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(type);
  return error as T;
}

describe('módulo de leads', () => {
  let admin: Actor;
  let manager: Actor;
  let sdr: Actor;
  let otherSdr: Actor;
  let sales: Actor;

  beforeEach(async () => {
    await resetTestData(db);
    googleSourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } })).id;
    thirdPartySourceId = (
      await db.leadSource.findUniqueOrThrow({ where: { key: 'THIRD_PARTY_LIST' } })
    ).id;
    admin = (await createActor('ADMIN')).actor;
    manager = (await createActor('MANAGER')).actor;
    sdr = (await createActor('SDR')).actor;
    otherSdr = (await createActor('SDR')).actor;
    sales = (await createActor('SALES')).actor;
  });

  afterAll(() => closeTestDb());

  describe('cadastro', () => {
    it('cria lead completo: SDR vira responsável, contato normalizado, origem, base legal, timeline e auditoria', async () => {
      const created = await createLead(
        deps,
        sdr,
        await leadInput({
          companyName: 'Exemplo Serviços Contábeis Ltda',
          cnpj: '11.222.333/0001-81',
          website: 'www.contabilexemplo.com.br/?utm_source=x',
          people: [{ fullName: 'Maria Clara Souza', roleTitle: 'Sócia', isDecisionMaker: true }],
          contactPoints: [
            { type: 'PHONE', value: '(88) 9999-0001', isWhatsapp: true, personIndex: 0 },
            { type: 'EMAIL', value: 'Contato@ContabilExemplo.com.br' },
            { type: 'INSTAGRAM', value: 'https://instagram.com/contabil.exemplo/' },
          ],
        }),
      );
      expect(created).toMatchObject({ code: 'L-000001', contactStatus: 'CONTACTABLE' });

      const lead = await getLead(deps, sdr, { leadId: created.id });
      expect(lead).toMatchObject({
        displayName: 'Contábil Exemplo',
        cnpj: '11222333000181',
        cnpjFormatted: '11.222.333/0001-81',
        cityRaw: 'Sobral',
        stateUf: 'CE',
        websiteUrl: 'https://www.contabilexemplo.com.br',
        websiteDomain: 'contabilexemplo.com.br',
        ownerId: sdr.kind === 'user' ? sdr.id : null,
        hasPhone: true,
        hasWhatsapp: true,
        hasEmail: true,
        hasInstagram: true,
        hasWebsite: true,
        legalBasis: { legalBasis: 'LEGITIMATE_INTEREST' },
        originSource: { key: 'GOOGLE' },
      });
      const phone = lead.contactPoints.find((cp) => cp.type === 'PHONE')!;
      expect(phone).toMatchObject({
        valueNormalized: '+5588999990001',
        display: '(88) 99999-0001',
        normalizationFlags: ['ADDED_NINTH_DIGIT'],
        whatsappStatus: 'PROBABLE',
        isPrimary: true,
        personId: lead.people[0]!.id,
        links: { tel: 'tel:+5588999990001', whatsapp: 'https://wa.me/5588999990001' },
      });
      expect(lead.people[0]).toMatchObject({ fullName: 'Maria Clara Souza', isPrimary: true });
      expect(lead.contactPoints.find((cp) => cp.type === 'INSTAGRAM')?.display).toBe(
        '@contabil.exemplo',
      );

      const events = await db.leadEvent.findMany({ where: { leadId: created.id } });
      expect(events.map((e) => e.type)).toEqual(['lead.created']);
      expect(JSON.stringify(events[0]!.payload)).not.toContain('99999');

      const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lead.create' } });
      expect(audit).toMatchObject({ entityType: 'lead', entityId: created.id });
      expect(await db.leadOrigin.count({ where: { leadId: created.id, isFirstTouch: true } })).toBe(
        1,
      );
    });

    it('completa telefone sem DDD com o DDD da cidade e registra a inferência', async () => {
      const created = await createLead(
        deps,
        sdr,
        await leadInput({ contactPoints: [{ type: 'PHONE', value: '3611-2233' }] }),
      );
      const cp = await db.contactPoint.findFirstOrThrow({ where: { leadId: created.id } });
      expect(cp).toMatchObject({
        valueNormalized: '+558836112233',
        phoneKind: 'LANDLINE',
        normalizationFlags: ['INFERRED_DDD'],
      });
    });

    it('base legal "não avaliada" deixa o lead sem permissão de contato', async () => {
      const created = await createLead(
        deps,
        sdr,
        await leadInput({
          origin: { sourceId: thirdPartySourceId, collectedAt: '2026-09-01' },
          legalBasis: 'NOT_ASSESSED',
        }),
      );
      expect(created.contactStatus).toBe('NO_LEGAL_BASIS');
    });

    it('valida cada campo e devolve todos os erros juntos', async () => {
      const error = await expectError(
        createLead(
          deps,
          sdr,
          await leadInput({
            tradeName: null,
            cnpj: '11.222.333/0001-82',
            origin: { sourceId: googleSourceId, collectedAt: '2027-01-01' },
            contactPoints: [
              { type: 'PHONE', value: '123' },
              { type: 'EMAIL', value: 'sem-arroba' },
            ],
          }),
        ),
        ValidationError,
      );
      expect(error.issues.map((i) => i.path).sort()).toEqual(['cnpj', 'tradeName']);
      // Erros de normalização de contato e de origem vêm na segunda validação (após os campos).
      const second = await expectError(
        createLead(
          deps,
          sdr,
          await leadInput({
            origin: { sourceId: googleSourceId, collectedAt: '2027-01-01' },
            contactPoints: [
              { type: 'PHONE', value: '123' },
              { type: 'EMAIL', value: 'sem-arroba' },
            ],
          }),
        ),
        ValidationError,
      );
      expect(second.issues.map((i) => i.path).sort()).toEqual([
        'contactPoints.0.value',
        'contactPoints.1.value',
        'origin.collectedAt',
      ]);
    });

    it('aceite M02: avisa antes de salvar quando o telefone já existe em outro formato', async () => {
      const first = await createLead(
        deps,
        sdr,
        await leadInput({ contactPoints: [{ type: 'PHONE', value: '+55 88 99999-9999' }] }),
      );
      const input = await leadInput({
        tradeName: 'Outro Escritório',
        contactPoints: [{ type: 'PHONE', value: '(88) 99999-9999' }],
      });

      const preview = await checkDuplicates(deps, sdr, {
        contactPoints: input.contactPoints,
      });
      expect(preview).toHaveLength(1);
      expect(preview[0]).toMatchObject({
        code: first.code,
        inScope: true,
        reasons: [{ kind: 'PHONE', detail: 'mesmo telefone (+55 88 9****-9999)', blocking: false }],
      });

      const error = await expectError(createLead(deps, sdr, input), PossibleDuplicateError);
      expect(error.code).toBe('POSSIBLE_DUPLICATE');
      expect(error.duplicates[0]?.code).toBe(first.code);

      const second = await createLead(deps, sdr, { ...input, acknowledgeDuplicates: true });
      expect(second.code).toBe('L-000002');
      const event = await db.leadEvent.findFirstOrThrow({ where: { leadId: second.id } });
      expect(event.payload).toMatchObject({ duplicatesAcknowledged: [first.code] });
    });

    it('CNPJ repetido bloqueia mesmo com confirmação, inclusive de lead arquivado', async () => {
      const first = await createLead(deps, sdr, await leadInput({ cnpj: '11222333000181' }));
      await archiveLead(deps, sdr, { leadId: first.id });
      const error = await expectError(
        createLead(
          deps,
          sdr,
          await leadInput({
            tradeName: 'Outro',
            cnpj: '11.222.333/0001-81',
            contactPoints: [],
            acknowledgeDuplicates: true,
          }),
        ),
        PossibleDuplicateError,
      );
      expect(error.message).toContain(first.code);
    });

    it('fora do escopo, o duplicado aparece só com o código', async () => {
      await createLead(deps, otherSdr, await leadInput());
      const [match] = await checkDuplicates(deps, sdr, {
        contactPoints: [{ type: 'PHONE', value: '88 99999 0001' }],
      });
      expect(match).toMatchObject({
        code: 'L-000001',
        inScope: false,
        leadId: null,
        displayName: null,
        ownerName: null,
      });
    });

    it('SDR não cadastra para outra pessoa; gestor pode escolher o responsável', async () => {
      const otherId = otherSdr.kind === 'user' ? otherSdr.id : '';
      await expectError(
        createLead(deps, sdr, await leadInput({ ownerId: otherId })),
        ForbiddenError,
      );
      const created = await createLead(deps, manager, await leadInput({ ownerId: otherId }));
      const lead = await db.lead.findUniqueOrThrow({ where: { id: created.id } });
      expect(lead.ownerId).toBe(otherId);
      expect(await db.leadAssignment.count({ where: { leadId: created.id } })).toBe(1);
      // Sem responsável indicado, o lead do gestor vai para o pool.
      const pool = await createLead(
        deps,
        manager,
        await leadInput({ tradeName: 'Pool', contactPoints: [] }),
      );
      expect((await db.lead.findUniqueOrThrow({ where: { id: pool.id } })).ownerId).toBeNull();
    });
  });

  describe('escopo por perfil (aceite M01)', () => {
    it('SDR não lê lead de outro SDR; a tentativa é auditada e o lead parece não existir', async () => {
      const lead = await createLead(deps, otherSdr, await leadInput());
      await expectError(getLead(deps, sdr, { leadId: lead.id }), NotFoundError);
      const denied = await db.auditLog.findFirstOrThrow({ where: { action: 'access.denied' } });
      expect(denied).toMatchObject({
        entityType: 'lead',
        entityId: lead.id,
        actorId: sdr.kind === 'user' ? sdr.id : null,
      });
      // Também não consegue alterar.
      await expectError(
        updateLead(deps, sdr, { leadId: lead.id, version: 1, tradeName: 'X' }),
        NotFoundError,
      );
    });

    it('id inexistente não gera registro de acesso negado', async () => {
      await expectError(
        getLead(deps, sdr, { leadId: '0199c0de-0000-7000-8000-000000000000' }),
        NotFoundError,
      );
      expect(await db.auditLog.count({ where: { action: 'access.denied' } })).toBe(0);
    });

    it('SDR vê o pool não atribuído só dos seus territórios e pode puxar o lead', async () => {
      const inCe = await createLead(
        deps,
        manager,
        await leadInput({ tradeName: 'Pool CE', contactPoints: [] }),
      );
      const inSp = await createLead(
        deps,
        manager,
        await leadInput({ tradeName: 'Pool SP', municipalityCode: SAO_PAULO, contactPoints: [] }),
      );
      // Sem território: nada do pool.
      await expectError(getLead(deps, sdr, { leadId: inCe.id }), NotFoundError);

      const sdrId = sdr.kind === 'user' ? sdr.id : '';
      await setUserTerritories(deps, admin, { userId: sdrId, territories: [{ stateUf: 'CE' }] });
      await expect(getLead(deps, sdr, { leadId: inCe.id })).resolves.toMatchObject({
        ownerId: null,
      });
      await expectError(getLead(deps, sdr, { leadId: inSp.id }), NotFoundError);

      await claimLead(deps, sdr, { leadId: inCe.id });
      expect((await db.lead.findUniqueOrThrow({ where: { id: inCe.id } })).ownerId).toBe(sdrId);
      const assignment = await db.leadAssignment.findFirstOrThrow({ where: { leadId: inCe.id } });
      expect(assignment).toMatchObject({ strategy: 'CLAIM', toUserId: sdrId });

      // Outro SDR do mesmo território não vê mais o lead (já tem responsável).
      const otherId = otherSdr.kind === 'user' ? otherSdr.id : '';
      await setUserTerritories(deps, admin, { userId: otherId, territories: [{ stateUf: 'CE' }] });
      await expectError(claimLead(deps, otherSdr, { leadId: inCe.id }), NotFoundError);
    });

    it('Comercial vê só os leads atribuídos a ele; gestor vê todos', async () => {
      const lead = await createLead(deps, sdr, await leadInput());
      await expectError(getLead(deps, sales, { leadId: lead.id }), NotFoundError);
      await expect(getLead(deps, manager, { leadId: lead.id })).resolves.toBeDefined();
      await assignLead(deps, manager, {
        leadId: lead.id,
        ownerId: sales.kind === 'user' ? sales.id : null,
      });
      await expect(getLead(deps, sales, { leadId: lead.id })).resolves.toBeDefined();
      await expectError(getLead(deps, sdr, { leadId: lead.id }), NotFoundError);
    });

    it('só ADMIN/GESTOR atribuem; território vale só para SDR e não aceita cidade dentro de UF inteira', async () => {
      const lead = await createLead(deps, sdr, await leadInput());
      await expectError(assignLead(deps, sdr, { leadId: lead.id, ownerId: null }), ForbiddenError);
      const sdrId = sdr.kind === 'user' ? sdr.id : '';
      const error = await expectError(
        setUserTerritories(deps, admin, {
          userId: sdrId,
          territories: [{ stateUf: 'CE' }, { stateUf: 'CE', municipalityCode: SOBRAL }],
        }),
        ValidationError,
      );
      expect(error.issues[0]?.message).toContain('UF CE inteira');
    });
  });

  describe('edição e partes do lead', () => {
    it('edita com lock otimista, audita o antes → depois e registra na timeline', async () => {
      const { id } = await createLead(deps, sdr, await leadInput());
      const updated = await updateLead(deps, sdr, {
        leadId: id,
        version: 1,
        tradeName: 'Contábil Exemplo & Filhos',
        municipalityCode: SAO_PAULO,
      });
      expect(updated).toMatchObject({
        version: 2,
        displayName: 'Contábil Exemplo & Filhos',
        stateUf: 'SP',
      });
      await expectError(
        updateLead(deps, sdr, { leadId: id, version: 1, category: 'x' }),
        ConflictError,
      );

      const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'lead.update' } });
      expect(audit.changes).toMatchObject({
        tradeName: ['Contábil Exemplo', 'Contábil Exemplo & Filhos'],
        municipalityCode: [SOBRAL, SAO_PAULO],
        stateUf: ['CE', 'SP'],
      });
      const history = await listLeadHistory(deps, sdr, { leadId: id });
      expect(history.data.map((h) => h.action)).toEqual(['lead.update', 'lead.create']);
      expect(history.data[0]).not.toHaveProperty('ip');
    });

    it('contatos: principal único por tipo, promoção automática e aviso de duplicado em outro lead', async () => {
      const other = await createLead(
        deps,
        sdr,
        await leadInput({
          tradeName: 'Outro',
          contactPoints: [{ type: 'EMAIL', value: 'x@empresa.com.br' }],
        }),
      );
      const { id } = await createLead(deps, sdr, await leadInput());
      const added = await addContactPoint(deps, sdr, {
        leadId: id,
        type: 'PHONE',
        value: '88 98888-0002',
        isPrimary: true,
      });
      expect(added.duplicates).toEqual([]);
      let lead = await getLead(deps, sdr, { leadId: id });
      expect(
        lead.contactPoints.filter((cp) => cp.isPrimary).map((cp) => cp.valueNormalized),
      ).toEqual(['+5588988880002']);

      await removeContactPoint(deps, sdr, { leadId: id, contactPointId: added.contactPointId });
      lead = await getLead(deps, sdr, { leadId: id });
      expect(lead.contactPoints).toHaveLength(1);
      expect(lead.contactPoints[0]?.isPrimary).toBe(true);

      const email = await addContactPoint(deps, sdr, {
        leadId: id,
        type: 'EMAIL',
        value: 'X@Empresa.com.br',
      });
      expect(email.duplicates.map((d) => d.code)).toEqual([other.code]);
      expect((await db.lead.findUniqueOrThrow({ where: { id } })).hasEmail).toBe(true);

      await expectError(
        addContactPoint(deps, sdr, { leadId: id, type: 'EMAIL', value: 'x@empresa.com.br' }),
        ConflictError,
      );
      // Contato inválido deixa de contar para o lead.
      const phoneId = lead.contactPoints[0]!.id;
      await updateContactPoint(deps, sdr, {
        leadId: id,
        contactPointId: phoneId,
        status: 'INVALID',
      });
      const after = await db.lead.findUniqueOrThrow({ where: { id } });
      expect(after).toMatchObject({ hasPhone: false, hasWhatsapp: false, hasEmail: true });
    });

    it('pessoas, observações e tags', async () => {
      const { id } = await createLead(deps, sdr, await leadInput());
      await addPerson(deps, sdr, {
        leadId: id,
        fullName: 'João Pedro Lima',
        roleTitle: 'Contador',
      });
      const note = await addNote(deps, sdr, { leadId: id, body: 'Prefere contato à tarde.' });
      expect(note.author?.id).toBe(sdr.kind === 'user' ? sdr.id : null);

      // Só o autor ou um ADMIN remove a observação.
      await expectError(removeNote(deps, manager, { leadId: id, noteId: note.id }), ForbiddenError);
      await removeNote(deps, sdr, { leadId: id, noteId: note.id });

      await expectError(createTag(deps, sdr, { name: 'Parceiro' }), ForbiddenError);
      const tag = await createTag(deps, manager, { name: 'Parceiro', color: 'green' });
      await expectError(createTag(deps, admin, { name: 'parceiro' }), ConflictError);
      await addLeadTag(deps, sdr, { leadId: id, tagId: tag.id });
      await addLeadTag(deps, sdr, { leadId: id, tagId: tag.id }); // idempotente

      const lead = await getLead(deps, sdr, { leadId: id });
      expect(lead.people.map((p) => p.fullName)).toEqual(['João Pedro Lima']);
      expect(lead.notes).toEqual([]);
      expect(lead.tags).toEqual([{ id: tag.id, name: 'Parceiro', color: 'green' }]);

      // A auditoria não guarda o texto da observação nem o nome completo.
      const audits = await db.auditLog.findMany({ where: { entityId: id } });
      const serialized = JSON.stringify(audits);
      expect(serialized).not.toContain('Prefere contato');
      expect(serialized).not.toContain('João Pedro Lima');
      expect(serialized).toContain('João L.');
    });

    it('arquivar e reativar; timeline paginada em ordem inversa', async () => {
      const { id } = await createLead(deps, sdr, await leadInput());
      await archiveLead(deps, sdr, { leadId: id, reason: 'Fechou o escritório' });
      await archiveLead(deps, systemActor('teste'), { leadId: id }); // idempotente
      await unarchiveLead(deps, sdr, { leadId: id });
      await expectError(unarchiveLead(deps, sdr, { leadId: id }), ConflictError);

      const page1 = await listLeadTimeline(deps, sdr, { leadId: id, limit: 2 });
      expect(page1.data.map((e) => e.type)).toEqual(['lead.unarchived', 'lead.archived']);
      expect(page1.data[0]?.actorName).toMatch(/Usuário SDR/);
      const page2 = await listLeadTimeline(deps, sdr, {
        leadId: id,
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.data.map((e) => e.type)).toEqual(['lead.created']);
      expect(page2.nextCursor).toBeNull();
    });

    it('lead anonimizado não pode ser editado', async () => {
      const { id } = await createLead(deps, sdr, await leadInput());
      await db.lead.update({ where: { id }, data: { status: 'ANONYMIZED' } });
      await expectError(addNote(deps, sdr, { leadId: id, body: 'x' }), ConflictError);
      await expectError(
        updateLead(deps, sdr, { leadId: id, version: 1, category: 'x' }),
        ConflictError,
      );
    });
  });
});
