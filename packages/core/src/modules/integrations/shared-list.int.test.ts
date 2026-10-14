import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { addSuppression } from '../compliance';
import { createLead, listLeadHistory, listLeadTimeline, type CreateLeadInput } from '../leads';
import { handoffToSales } from '../opportunities';
import {
  authenticateApiKey,
  checkSuppressions,
  createApiKey,
  findExternalReferences,
  getIntegrationLead,
  registerExternalOptOut,
  removeExternalReference,
  upsertExternalReference,
  type ApiScope,
} from '../..';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, createActor } = createTestDeps();
const SOBRAL = 2312908;
const CNPJ = '11.222.333/0001-81'; // número de exemplo (dígitos válidos), fictício
const QUALIFICATION = {
  decisionMaker: 'Sócio fictício',
  interest: 'Quer conhecer o certificado digital.',
  bestChannelAndTime: 'WhatsApp, tarde',
  clientCount: 40,
};

describe('referências externas e Lista Não Contatar compartilhada (F12-03, F12-04)', () => {
  let admin: UserActor;
  let sdr: UserActor;
  let sales: UserActor;
  let sourceId: string;

  const make = (name: string, phone: string, extra: Partial<CreateLeadInput> = {}) =>
    createLead(deps, sdr, {
      tradeName: name,
      municipalityCode: SOBRAL,
      origin: { sourceId, collectedAt: '2026-10-01' },
      legalBasis: 'LEGITIMATE_INTEREST',
      contactPoints: [{ type: 'PHONE', value: phone, isWhatsapp: true }],
      acknowledgeDuplicates: true,
      ...extra,
    });

  const key = async (scopes: ApiScope[], system: string | null = 'DOCLINE_CRM') => {
    const created = await createApiKey(deps, admin, { name: 'CRM fictício', scopes, system });
    return authenticateApiKey(deps, created.key);
  };

  beforeEach(async () => {
    await resetTestData(db);
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
    sales = (await createActor('SALES')).actor as UserActor;
  });
  afterAll(() => closeTestDb());

  it('referências: a chave grava no próprio sistema; um id externo, um registro', async () => {
    const crm = await key(['references:write']);
    const lead = await make('Escritório Fictício Pequi', '(88) 99744-0001');
    const other = await make('Escritório Fictício Buriti', '(88) 99744-0002');

    const linked = await upsertExternalReference(deps, crm, {
      entityType: 'LEAD',
      entityId: lead.id,
      externalId: 'CRM-1001',
      url: 'https://crm.example.com/contas/1001',
    });
    expect(linked).toMatchObject({ system: 'DOCLINE_CRM', created: true });
    const row = await db.externalReference.findFirstOrThrow();
    expect(row.createdByKeyId).toBe(crm.id);

    // Mesmo pedido de novo: nada muda, nada na auditoria.
    await upsertExternalReference(deps, crm, {
      entityType: 'LEAD',
      entityId: lead.id,
      externalId: 'CRM-1001',
    });
    const updated = await upsertExternalReference(deps, crm, {
      entityType: 'LEAD',
      entityId: lead.id,
      externalId: 'CRM-1002',
    });
    expect(updated.created).toBe(false);
    const history = await listLeadHistory(deps, admin, { leadId: lead.id });
    const refs = history.data.filter((h) => h.action.startsWith('reference.'));
    expect(refs.map((h) => h.action)).toEqual(['reference.update', 'reference.link']);
    expect(refs[0]).toMatchObject({
      actorType: 'INTEGRATION',
      actorName: 'CRM fictício (integração)',
      changes: { 'reference.DOCLINE_CRM': ['CRM-1001', 'CRM-1002'] },
    });

    await expect(
      upsertExternalReference(deps, crm, {
        entityType: 'LEAD',
        entityId: other.id,
        externalId: 'CRM-1002',
      }),
    ).rejects.toThrow(ConflictError);
    await expect(
      upsertExternalReference(deps, crm, {
        entityType: 'LEAD',
        entityId: other.id,
        system: 'GESTAO_AR',
        externalId: 'AR-1',
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      upsertExternalReference(deps, admin, {
        entityType: 'LEAD',
        entityId: other.id,
        externalId: 'X-1',
      }),
    ).rejects.toMatchObject({ issues: [{ path: 'system' }] });
    // Só leitura não grava.
    const reader = await key(['references:read']);
    await expect(
      upsertExternalReference(deps, reader, {
        entityType: 'LEAD',
        entityId: other.id,
        externalId: 'CRM-9',
      }),
    ).rejects.toThrow(ForbiddenError);

    const found = await findExternalReferences(deps, reader, {
      entityType: 'LEAD',
      externalId: 'CRM-1002',
    });
    expect(found.data).toEqual([
      expect.objectContaining({
        entityId: lead.id,
        systemLabel: 'CRM Docline',
        lead: { id: lead.id, code: expect.stringMatching(/^L-\d{6}$/) },
      }),
    ]);

    await removeExternalReference(deps, crm, { entityType: 'LEAD', entityId: lead.id });
    await expect(
      removeExternalReference(deps, crm, { entityType: 'LEAD', entityId: lead.id }),
    ).rejects.toThrow(NotFoundError);
    expect(await db.externalReference.count()).toBe(0);
  });

  it('ficha para o CRM: só lead transferido ou vinculado; contatos com Não Contatar', async () => {
    const crm = await key(['leads:read']);
    const lead = await make('Escritório Fictício Cajá', '(88) 99744-0003', { cnpj: CNPJ });
    await expect(getIntegrationLead(deps, crm, { leadId: lead.id })).rejects.toThrow(
      'não liberado para integração',
    );

    const opportunity = await handoffToSales(deps, sdr, {
      leadId: lead.id,
      salesOwnerId: sales.id,
      qualification: QUALIFICATION,
    });
    await addSuppression(deps, admin, {
      type: 'PHONE',
      value: '(88) 99744-0003',
      scope: 'WHATSAPP',
      reason: 'OPT_OUT',
    });
    const view = await getIntegrationLead(deps, crm, { leadId: lead.id });
    expect(view).toMatchObject({
      displayName: 'Escritório Fictício Cajá',
      cnpj: CNPJ,
      anonymized: false,
      doNotContact: [],
      contactPoints: [
        { type: 'PHONE', display: '(88) 99744-0003', doNotContact: [{ scope: 'WHATSAPP' }] },
      ],
      opportunities: [{ id: opportunity.id, status: 'OPEN', sdr: { id: sdr.id } }],
    });
    expect(view).not.toHaveProperty('notes');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'lead.integration_read' },
    });
    expect(audit).toMatchObject({ actorType: 'INTEGRATION', actorId: crm.id, entityId: lead.id });

    // Pessoa: segue o escopo dela (SDR de outro território não vê).
    const { actor: stranger } = await createActor('SALES');
    await expect(getIntegrationLead(deps, stranger, { leadId: lead.id })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('consulta: valor, canal e escritório inteiro, sem revelar a lista', async () => {
    const crm = await key(['suppression:check']);
    const lead = await make('Escritório Fictício Murici', '(88) 99744-0004', { cnpj: CNPJ });
    await addSuppression(deps, admin, {
      type: 'EMAIL',
      value: 'socio.ficticio@example.com',
      scope: 'EMAIL',
      reason: 'OPT_OUT',
    });

    const before = await checkSuppressions(deps, crm, {
      identifiers: [
        { type: 'PHONE', value: '(88) 99744-0004' },
        { type: 'EMAIL', value: 'SOCIO.FICTICIO@example.com' },
        { type: 'PHONE', value: '123' },
      ],
    });
    expect(before.results).toEqual([
      expect.objectContaining({ index: 0, valid: true, suppressed: false, via: null }),
      expect.objectContaining({
        index: 1,
        valid: true,
        suppressed: true,
        via: 'IDENTIFIER',
        scopes: ['EMAIL'],
        valueMasked: expect.not.stringContaining('socio.ficticio'),
      }),
      expect.objectContaining({ index: 2, valid: false, suppressed: false }),
    ]);
    // Só o canal pedido: e-mail bloqueado não impede o WhatsApp.
    const whatsapp = await checkSuppressions(deps, crm, {
      identifiers: [{ type: 'EMAIL', value: 'socio.ficticio@example.com' }],
      channel: 'WHATSAPP',
    });
    expect(whatsapp.results[0]).toMatchObject({ suppressed: false });

    // CNPJ do escritório na lista: os contatos dele também ficam bloqueados.
    await addSuppression(deps, admin, { type: 'CNPJ', value: CNPJ, reason: 'OPT_OUT' });
    const after = await checkSuppressions(deps, crm, {
      identifiers: [
        { type: 'PHONE', value: '(88) 99744-0004' },
        { type: 'CNPJ', value: CNPJ },
      ],
    });
    expect(after.results).toEqual([
      expect.objectContaining({ suppressed: true, via: 'ORGANIZATION', scopes: [] }),
      expect.objectContaining({ suppressed: true, via: 'IDENTIFIER' }),
    ]);
    expect(JSON.stringify(after)).not.toContain('OPT_OUT');
    expect(lead.id).toBeTruthy();
  });

  it('opt-out vindo do CRM: origem INTEGRATION, vale na hora e derruba o opt-in', async () => {
    const crm = await key(['suppression:write']);
    const lead = await make('Escritório Fictício Bacuri', '(88) 99744-0005');
    const point = await db.contactPoint.findFirstOrThrow({ where: { leadId: lead.id } });
    await db.contactPermission.create({
      data: {
        leadId: lead.id,
        contactPointId: point.id,
        channel: 'WHATSAPP',
        legalBasis: 'CONSENT',
        optInStatus: 'GRANTED',
        optInMethod: 'FORM',
        evidence: 'Formulário fictício',
      },
    });

    const result = await registerExternalOptOut(deps, crm, {
      identifiers: [
        { type: 'PHONE', value: '+55 88 99744-0005' },
        { type: 'EMAIL', value: 'nao.quer@example.com' },
      ],
      notes: 'Pedido pelo telefone da central',
    });
    expect(result).toEqual({ created: 2, alreadySuppressed: 0, affectedLeads: 1 });
    const entries = await db.suppressionEntry.findMany({ orderBy: { type: 'asc' } });
    expect(entries.map((e) => [e.type, e.source])).toEqual([
      ['PHONE', 'INTEGRATION'],
      ['EMAIL', 'INTEGRATION'],
    ]);
    expect(entries[0]!.notes).toBe('Recebido de CRM fictício: Pedido pelo telefone da central');
    expect(await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      contactStatus: 'OPTED_OUT',
    });
    expect(
      await db.contactPermission.findFirstOrThrow({ where: { contactPointId: point.id } }),
    ).toMatchObject({ optInStatus: 'REVOKED' });
    const timeline = await listLeadTimeline(deps, admin, { leadId: lead.id });
    expect(timeline.data[0]).toMatchObject({
      type: 'optout.registered',
      actorType: 'INTEGRATION',
      actorName: 'CRM fictício (integração)',
      payload: { via: 'CRM fictício' },
    });
    // Volta para os outros sistemas como evento, com a origem.
    const event = await db.outboundEvent.findFirstOrThrow({ where: { type: 'optout.registered' } });
    expect(event.payload).toMatchObject({
      suppressions: [{ source: 'INTEGRATION' }, { source: 'INTEGRATION' }],
    });

    // De novo: nada novo.
    expect(
      await registerExternalOptOut(deps, crm, {
        identifiers: [{ type: 'PHONE', value: '(88) 99744-0005' }],
      }),
    ).toMatchObject({ created: 0, alreadySuppressed: 1 });
    await expect(
      registerExternalOptOut(deps, crm, { identifiers: [{ type: 'PHONE', value: '12' }] }),
    ).rejects.toMatchObject({ issues: [{ path: 'identifiers.0.value' }] });
    const checker = await key(['suppression:check']);
    await expect(
      registerExternalOptOut(deps, checker, {
        identifiers: [{ type: 'EMAIL', value: 'outro@example.com' }],
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});
