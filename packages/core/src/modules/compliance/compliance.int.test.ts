import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { ConflictError, ForbiddenError, ValidationError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import {
  addNote,
  addPerson,
  anonymizeLead,
  archiveLead,
  createLead,
  getLead,
  getLeadContactability,
  registerOptOut,
  setChannelPermission,
  type CreateLeadInput,
} from '../leads';
import {
  addSuppression,
  createDataSubjectRequest,
  createLegalBasisAssessment,
  listDataSubjectRequests,
  listLegalBasisAssessments,
  listSuppressions,
  revokeSuppression,
  updateDataSubjectRequest,
} from '.';

const { db, deps, createActor } = createTestDeps({ now: new Date('2026-10-13T12:00:00Z') });
const SOBRAL = 2312908;

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

describe('conformidade (LGPD)', () => {
  let admin: Actor;
  let manager: Actor;
  let sdr: Actor;
  let sourceId: string;

  const input = (overrides: Partial<CreateLeadInput> = {}): CreateLeadInput => ({
    tradeName: 'Escritório Fictício',
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [
      { type: 'PHONE', value: '(88) 99999-1111', isWhatsapp: true },
      { type: 'EMAIL', value: 'contato@ficticio.com.br' },
    ],
    acknowledgeDuplicates: true,
    ...overrides,
  });

  const statusOf = async (leadId: string) =>
    (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).contactStatus;

  beforeEach(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'GOOGLE' } })).id;
    admin = (await createActor('ADMIN')).actor;
    manager = (await createActor('MANAGER')).actor;
    sdr = (await createActor('SDR')).actor;
  });

  afterAll(() => closeTestDb());

  describe('opt-out e Lista Não Contatar', () => {
    it('opt-out de todos os canais: vale por identificador, inclusive para outros leads e reimportações', async () => {
      const lead = await createLead(deps, sdr, input({ cnpj: '11.222.333/0001-81' }));
      const other = await createLead(
        deps,
        sdr,
        input({
          tradeName: 'Outro Escritório',
          contactPoints: [
            { type: 'PHONE', value: '+55 88 99999-1111' },
            { type: 'EMAIL', value: 'outro@ficticio.com.br' },
          ],
        }),
      );

      const result = await registerOptOut(deps, sdr, { leadId: lead.id });
      expect(result).toMatchObject({ contactStatus: 'OPTED_OUT', affectedLeads: 2 });

      // Telefone, e-mail, o lead e o CNPJ entram na lista, com valores mascarados.
      const entries = await db.suppressionEntry.findMany({ orderBy: { type: 'asc' } });
      expect(entries.map((e) => [e.type, e.valueMasked, e.source])).toEqual([
        ['PHONE', '+55 88 9****-1111', 'SDR'],
        ['EMAIL', 'c***@ficticio.com.br', 'SDR'],
        ['CNPJ', '11.222.***/****-81', 'SDR'],
        ['LEAD', 'L-000001', 'SDR'],
      ]);
      expect(JSON.stringify(entries)).not.toContain('99999-1111');

      // O outro lead perdeu o telefone, mas ainda tem e-mail próprio.
      expect(await statusOf(other.id)).toBe('RESTRICTED');
      const gate = await getLeadContactability(deps, sdr, { leadId: other.id });
      expect(gate.channels.find((c) => c.channel === 'WHATSAPP')).toMatchObject({
        allowed: false,
        reasons: ['Contato na Lista Não Contatar desde 13/10/2026 (pediu para não ser contatado).'],
      });
      expect(gate.channels.find((c) => c.channel === 'EMAIL')?.allowed).toBe(true);

      const events = await db.leadEvent.findMany({ where: { type: 'optout.registered' } });
      expect(events).toHaveLength(2);

      // Um novo cadastro com o mesmo telefone nasce bloqueado.
      const again = await createLead(
        deps,
        sdr,
        input({
          tradeName: 'Recadastro',
          contactPoints: [{ type: 'PHONE', value: '88999991111' }],
        }),
      );
      expect(again.contactStatus).toBe('OPTED_OUT');

      // Repetir o opt-out não duplica registros.
      await registerOptOut(deps, sdr, { leadId: lead.id });
      expect(await db.suppressionEntry.count()).toBe(4);
    });

    it('opt-out de um canal só bloqueia aquele canal', async () => {
      const lead = await createLead(deps, sdr, input());
      const result = await registerOptOut(deps, sdr, { leadId: lead.id, scope: 'WHATSAPP' });
      expect(result.contactStatus).toBe('RESTRICTED');
      const gate = await getLeadContactability(deps, sdr, { leadId: lead.id });
      expect(gate.channels.map((c) => [c.channel, c.allowed])).toEqual([
        ['WHATSAPP', false],
        ['PHONE', true],
        ['EMAIL', true],
        ['INSTAGRAM', false],
      ]);
    });

    it('opt-out de um contato específico', async () => {
      const lead = await createLead(deps, sdr, input());
      const detail = await getLead(deps, sdr, { leadId: lead.id });
      const email = detail.contactPoints.find((cp) => cp.type === 'EMAIL')!;
      await registerOptOut(deps, sdr, { leadId: lead.id, contactPointId: email.id });
      const after = await getLead(deps, sdr, { leadId: lead.id });
      expect(after.contactPoints.find((cp) => cp.id === email.id)?.suppressions).toHaveLength(1);
      expect(after.contactStatus).toBe('RESTRICTED');
      expect(await db.suppressionEntry.count()).toBe(1);
    });

    it('inclusão manual pelo valor atinge o lead que tiver aquele contato', async () => {
      const lead = await createLead(deps, sdr, input());
      const result = await addSuppression(deps, sdr, {
        type: 'EMAIL',
        value: ' CONTATO@ficticio.com.br ',
        reason: 'COMPLAINT',
      });
      expect(result).toEqual({ created: true, alreadySuppressed: false, affectedLeads: 1 });
      expect(await statusOf(lead.id)).toBe('RESTRICTED');
      await expectError(
        addSuppression(deps, sdr, { type: 'PHONE', value: '123' }),
        ValidationError,
      );
    });

    it('revogação: só ADMIN, com motivo, uma vez; o lead volta a ser contactável', async () => {
      const lead = await createLead(deps, sdr, input());
      await registerOptOut(deps, sdr, { leadId: lead.id });
      const [entry] = await db.suppressionEntry.findMany({ where: { type: 'LEAD' } });

      await expectError(
        revokeSuppression(deps, manager, { suppressionId: entry!.id, reason: 'Pediu para voltar' }),
        ForbiddenError,
      );
      await expectError(
        revokeSuppression(deps, admin, { suppressionId: entry!.id, reason: 'curto' }),
        ValidationError,
      );

      for (const e of await db.suppressionEntry.findMany()) {
        await revokeSuppression(deps, admin, {
          suppressionId: e.id,
          reason: 'Titular pediu por e-mail para voltar a receber contato.',
        });
      }
      expect(await statusOf(lead.id)).toBe('CONTACTABLE');
      await expectError(
        revokeSuppression(deps, admin, {
          suppressionId: entry!.id,
          reason: 'Revogando de novo por engano.',
        }),
        ConflictError,
      );
      expect(await db.leadEvent.count({ where: { type: 'suppression.revoked' } })).toBe(3);
    });

    it('consulta da lista: só ADMIN/GESTOR, valores mascarados, busca por qualquer formato do valor', async () => {
      const lead = await createLead(deps, sdr, input());
      await registerOptOut(deps, sdr, { leadId: lead.id, scope: 'WHATSAPP' });
      await expectError(listSuppressions(deps, sdr, {}), ForbiddenError);
      const found = await listSuppressions(deps, manager, { value: '88 9 9999 1111' });
      expect(found.data).toHaveLength(1);
      expect(found.data[0]).toMatchObject({
        type: 'PHONE',
        valueMasked: '+55 88 9****-1111',
        scope: 'WHATSAPP',
        lead: { id: lead.id },
      });
      expect(found.data[0]).not.toHaveProperty('valueHash');
    });
  });

  describe('base legal e opt-in por canal', () => {
    it('só ADMIN/GESTOR alteram; consentimento e opt-in exigem evidência; opt-in libera o modo API', async () => {
      const lead = await createLead(deps, sdr, input({ legalBasis: 'NOT_ASSESSED' }));
      expect(lead.contactStatus).toBe('NO_LEGAL_BASIS');

      await expectError(
        setChannelPermission(deps, sdr, {
          leadId: lead.id,
          channel: 'ALL',
          legalBasis: 'LEGITIMATE_INTEREST',
        }),
        ForbiddenError,
      );
      const updated = await setChannelPermission(deps, manager, {
        leadId: lead.id,
        channel: 'ALL',
        legalBasis: 'LEGITIMATE_INTEREST',
      });
      expect(updated.contactStatus).toBe('CONTACTABLE');

      const invalid = await expectError(
        setChannelPermission(deps, manager, {
          leadId: lead.id,
          channel: 'INSTAGRAM',
          legalBasis: 'CONSENT',
          optInStatus: 'GRANTED',
        }),
        ValidationError,
      );
      expect(invalid.issues.map((i) => i.path).sort()).toEqual([
        'evidence',
        'evidence',
        'optInMethod',
      ]);
      // Fase 7: o opt-in do WhatsApp é do número (módulo whatsapp), não do lead.
      const perNumber = await expectError(
        setChannelPermission(deps, manager, {
          leadId: lead.id,
          channel: 'WHATSAPP',
          legalBasis: 'CONSENT',
          optInStatus: 'GRANTED',
          optInMethod: 'FORM',
          evidence: 'Formulário do evento X em 10/10/2026',
        }),
        ValidationError,
      );
      expect(perNumber.issues).toEqual([
        {
          path: 'optInStatus',
          message: 'O opt-in do WhatsApp é registrado por número, na seção WhatsApp do lead.',
        },
      ]);

      const api = await getLeadContactability(deps, sdr, { leadId: lead.id, mode: 'API' });
      expect(api.channels[0]?.allowed).toBe(false);
      await setChannelPermission(deps, manager, {
        leadId: lead.id,
        channel: 'INSTAGRAM',
        legalBasis: 'CONSENT',
        optInStatus: 'GRANTED',
        optInMethod: 'FORM',
        evidence: 'Formulário do evento X em 10/10/2026',
      });
      expect(
        await db.leadEvent.count({ where: { leadId: lead.id, type: 'permission.changed' } }),
      ).toBe(2);
    });

    it('avaliações de base legal: só ADMIN cria; nova versão a cada registro com o mesmo nome', async () => {
      const lia = {
        name: 'LIA — Prospecção B2B',
        legalBasis: 'LEGITIMATE_INTEREST' as const,
        purpose: 'Oferecer parceria a escritórios de contabilidade.',
      };
      await expectError(createLegalBasisAssessment(deps, manager, lia), ForbiddenError);
      await createLegalBasisAssessment(deps, admin, lia);
      const second = await createLegalBasisAssessment(deps, admin, lia);
      expect(second.version).toBe(2);
      expect(await listLegalBasisAssessments(deps, sdr, {})).toHaveLength(2);
    });
  });

  describe('anonimização e titulares', () => {
    it('ADMIN anonimiza: some todo dado pessoal, o pedido continua valendo e as métricas ficam', async () => {
      const lead = await createLead(
        deps,
        sdr,
        input({
          companyName: 'Fictícia Contabilidade Ltda',
          cnpj: '11222333000181',
          website: 'ficticio.com.br',
        }),
      );
      await addPerson(deps, sdr, {
        leadId: lead.id,
        fullName: 'Ana Beatriz Fictícia',
        roleTitle: 'Sócia',
      });
      await addNote(deps, sdr, { leadId: lead.id, body: 'Anotação com dado pessoal.' });
      const request = await createDataSubjectRequest(deps, admin, {
        requesterName: 'Ana Beatriz Fictícia',
        requesterContact: 'ana@ficticio.com.br',
        type: 'ANONYMIZATION',
        receivedAt: '2026-10-12',
      });

      await expectError(
        anonymizeLead(deps, manager, {
          leadId: lead.id,
          reason: 'Pedido de anonimização do titular',
        }),
        ForbiddenError,
      );
      const result = await anonymizeLead(deps, admin, {
        leadId: lead.id,
        reason: 'Pedido de anonimização do titular',
        dataSubjectRequestId: request.id,
      });
      expect(result).toMatchObject({
        status: 'ANONYMIZED',
        contactStatus: 'OPTED_OUT',
        suppressed: 4,
      });

      const row = await db.lead.findUniqueOrThrow({
        where: { id: lead.id },
        include: { people: true, contactPoints: true, notes: true, origins: true },
      });
      const serialized = JSON.stringify(row);
      for (const piece of [
        'Fictícia Contabilidade',
        'Ana Beatriz',
        '99999',
        'contato@',
        '11222333000181',
        'ficticio.com.br',
        'dado pessoal',
      ]) {
        expect(serialized, piece).not.toContain(piece);
      }
      expect(row).toMatchObject({
        displayName: 'Lead anonimizado L-000001',
        cityRaw: 'Sobral',
        stateUf: 'CE',
      });
      expect(
        await db.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({
        leadId: lead.id,
      });
      expect(
        await db.suppressionEntry.count({
          where: { reason: 'DATA_SUBJECT_REQUEST', source: 'DSR' },
        }),
      ).toBe(4);

      // O pedido sobrevive: um recadastro do mesmo CNPJ ou telefone nasce bloqueado.
      const again = await createLead(
        deps,
        sdr,
        input({ tradeName: 'Recadastro', cnpj: '11.222.333/0001-81', contactPoints: [] }),
      );
      expect(again.contactStatus).toBe('OPTED_OUT');

      await expectError(
        anonymizeLead(deps, admin, { leadId: lead.id, reason: 'Repetindo a anonimização' }),
        ConflictError,
      );
      await expectError(archiveLead(deps, sdr, { leadId: lead.id }), ConflictError);
    });

    it('solicitações de titulares: só ADMIN; prazo de 15 dias; conclusão registra data; auditoria sem o contato do titular', async () => {
      const data = {
        requesterName: 'Titular Fictício',
        requesterContact: 'titular@ficticio.com.br',
        type: 'ACCESS' as const,
        receivedAt: '2026-09-20',
      };
      await expectError(createDataSubjectRequest(deps, manager, data), ForbiddenError);
      const request = await createDataSubjectRequest(deps, admin, data);
      expect(request.dueAt.toISOString()).toBe('2026-10-05T00:00:00.000Z');

      const list = await listDataSubjectRequests(deps, admin, {});
      expect(list.data[0]).toMatchObject({ id: request.id, overdue: true });

      const done = await updateDataSubjectRequest(deps, admin, {
        requestId: request.id,
        status: 'COMPLETED',
        responseSummary: 'Dados enviados por e-mail.',
      });
      expect(done.resolvedAt?.toISOString()).toBe('2026-10-13T12:00:00.000Z');
      const audits = await db.auditLog.findMany({ where: { entityType: 'data_subject_request' } });
      expect(audits).toHaveLength(2);
      expect(JSON.stringify(audits)).not.toContain('titular@ficticio');
    });
  });
});
