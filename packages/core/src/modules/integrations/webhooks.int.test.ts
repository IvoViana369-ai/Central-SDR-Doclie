import { closeTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '../../shared/actor';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../shared/errors';
import { createTestDeps } from '../../testing/test-deps';
import { addSuppression, revokeSuppression } from '../compliance';
import { createLead, registerOptOut, type CreateLeadInput } from '../leads';
import { acceptOpportunity, handoffToSales, markOpportunityWon } from '../opportunities';
import {
  createApiKey,
  authenticateApiKey,
  createWebhookEndpoint,
  deriveWebhookSecret,
  listWebhookDeliveries,
  listWebhookEndpoints,
  purgeOutboundEvents,
  resendWebhookDelivery,
  rotateWebhookSecret,
  runWebhookDispatch,
  sendTestWebhook,
  setWebhookEndpointStatus,
  updateWebhookEndpoint,
  verifyWebhookSignature,
} from '.';

type UserActor = Extract<Actor, { kind: 'user' }>;

const { db, deps, enqueued, webhookSender, createActor } = createTestDeps();
const clock = deps.clock as typeof deps.clock & { set(d: Date): void; advance(ms: number): void };
const START = new Date('2026-10-13T12:00:00Z'); // terça, 09:00 em Fortaleza
const SOBRAL = 2312908;
const CRM_URL = 'https://crm.example.com/webhooks/sdr?token=segredo-do-receptor';
const MASTER = deps.webhooks.signingSecret!;
const QUALIFICATION = {
  decisionMaker: 'Sócia fictícia — contadora responsável',
  interest: 'Quer oferecer certificado digital aos clientes do escritório.',
  bestChannelAndTime: 'WhatsApp, manhãs',
  clientCount: 120,
};

describe('webhooks de saída (F12-02)', () => {
  let admin: UserActor;
  let sdr: UserActor;
  let sales: UserActor;
  let sourceId: string;
  let phone = 4100;

  const make = (name: string): CreateLeadInput => ({
    tradeName: name,
    municipalityCode: SOBRAL,
    origin: { sourceId, collectedAt: '2026-10-01' },
    legalBasis: 'LEGITIMATE_INTEREST',
    contactPoints: [{ type: 'PHONE', value: `(88) 99733-${++phone}`, isWhatsapp: true }],
    acknowledgeDuplicates: true,
  });

  const endpoint = (events: string[] = ['opportunity.created', 'lead.converted']) =>
    createWebhookEndpoint(deps, admin, {
      name: 'CRM Docline',
      url: CRM_URL,
      events: events as never,
      system: 'DOCLINE_CRM',
    });

  const handoff = async (name: string) => {
    const lead = await createLead(deps, sdr, make(name));
    const opportunity = await handoffToSales(deps, sdr, {
      leadId: lead.id,
      salesOwnerId: sales.id,
      qualification: QUALIFICATION,
    });
    return { lead, opportunity };
  };

  beforeEach(async () => {
    clock.set(START);
    await resetTestData(db);
    webhookSender.requests.length = 0;
    enqueued.length = 0;
    deps.webhooks.signingSecret = MASTER;
    webhookSender.respond(CRM_URL, { status: 200 });
    sourceId = (await db.leadSource.findUniqueOrThrow({ where: { key: 'EVENT' } })).id;
    admin = (await createActor('ADMIN')).actor as UserActor;
    sdr = (await createActor('SDR')).actor as UserActor;
    sales = (await createActor('SALES')).actor as UserActor;
  });
  afterAll(() => closeTestDb());

  it('cadastro: segredo só na criação, URL conferida e auditoria sem a query', async () => {
    const created = await endpoint();
    expect(created.secret).toBe(deriveWebhookSecret(MASTER, created.endpoint.id, 1));
    expect(created.endpoint).toMatchObject({
      status: 'ACTIVE',
      systemLabel: 'CRM Docline',
      eventLabels: ['Oportunidade criada', 'Lead convertido'],
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'webhook_endpoint.create' },
    });
    expect(JSON.stringify(audit.changes)).toContain('https://crm.example.com/webhooks/sdr?…');
    expect(JSON.stringify(audit)).not.toContain('segredo-do-receptor');
    expect(JSON.stringify(audit)).not.toContain(created.secret);

    for (const url of [
      'http://crm.example.com/hook',
      'https://localhost/hook',
      'https://10.0.0.5/hook',
      'https://169.254.169.254/latest/meta-data',
    ]) {
      await expect(
        createWebhookEndpoint(deps, admin, { name: 'Interno', url, events: ['lead.converted'] }),
      ).rejects.toMatchObject({ issues: [{ path: 'url' }] });
    }
    await expect(
      updateWebhookEndpoint(deps, admin, {
        endpointId: created.endpoint.id,
        url: 'https://127.0.0.1/x',
      }),
    ).rejects.toMatchObject({ issues: [{ path: 'url' }] });

    const { actor: manager } = await createActor('MANAGER');
    await expect(listWebhookEndpoints(deps, manager, {})).rejects.toThrow(ForbiddenError);
    const { key } = await createApiKey(deps, admin, { name: 'CRM', scopes: ['leads:read'] });
    const keyActor = await authenticateApiKey(deps, key);
    await expect(listWebhookEndpoints(deps, keyActor, {})).rejects.toThrow(ForbiddenError);

    deps.webhooks.signingSecret = null;
    await expect(endpoint()).rejects.toThrow(BusinessRuleError);
    expect((await listWebhookEndpoints(deps, admin, {})).enabled).toBe(false);
    expect(await runWebhookDispatch(deps)).toMatchObject({ skipped: 'NO_SECRET', sent: 0 });
  });

  it('outbox na transação da transferência; envio assinado, só ids e códigos', async () => {
    const { endpoint: crm, secret } = await endpoint();
    const { lead, opportunity } = await handoff('Escritório Fictício Ipê');

    // Evento e entrega na mesma transação; o worker é chamado depois do commit.
    const event = await db.outboundEvent.findFirstOrThrow({
      where: { type: 'opportunity.created' },
    });
    expect(event.leadId).toBe(lead.id);
    expect(await db.webhookDelivery.count({ where: { eventId: event.id } })).toBe(1);
    expect(enqueued.filter((j) => j.name === 'webhooks.dispatch')).toHaveLength(1);

    // Aceite: tipo não assinado pelo destino → evento gravado, sem entrega.
    await acceptOpportunity(deps, sales, { opportunityId: opportunity.id });
    const accepted = await db.outboundEvent.findFirstOrThrow({
      where: { type: 'opportunity.accepted' },
    });
    expect(await db.webhookDelivery.count({ where: { eventId: accepted.id } })).toBe(0);

    const result = await runWebhookDispatch(deps);
    expect(result).toMatchObject({ sent: 1, succeeded: 1, failed: 0 });
    const [request] = webhookSender.requests;
    expect(request!.url).toBe(CRM_URL);
    expect(request!.headers).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'docline-event': 'opportunity.created',
      'docline-event-id': event.id,
      'docline-delivery-attempt': '1',
    });
    expect(
      verifyWebhookSignature(secret, request!.headers['docline-signature']!, request!.body, START),
    ).toBe(true);
    const body = JSON.parse(request!.body);
    expect(body).toMatchObject({
      id: event.id,
      type: 'opportunity.created',
      apiVersion: '2026-10-14',
      data: {
        opportunity: {
          id: opportunity.id,
          status: 'OPEN',
          sdrId: sdr.id,
          salesOwnerId: sales.id,
          references: [],
        },
        lead: { id: lead.id, stateUf: 'CE', municipalityCode: SOBRAL, references: [] },
      },
    });
    expect(body.data.lead.code).toMatch(/^L-\d{6}$/);
    // Sem nome, telefone nem checklist no corpo.
    expect(request!.body).not.toContain('Ipê');
    expect(request!.body).not.toContain('99733');
    expect(request!.body).not.toContain('contadora');

    const delivery = await db.webhookDelivery.findFirstOrThrow({ where: { eventId: event.id } });
    expect(delivery).toMatchObject({ status: 'SUCCEEDED', attempts: 1, lastStatusCode: 200 });
    const after = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: crm.id } });
    expect(after.lastSuccessAt).toEqual(START);

    // Ganha → lead.converted, com a referência externa gravada pelo CRM.
    await db.externalReference.create({
      data: {
        entityType: 'LEAD',
        entityId: lead.id,
        system: 'DOCLINE_CRM',
        externalId: 'CRM-778',
        syncedAt: START,
      },
    });
    await markOpportunityWon(deps, sales, {
      opportunityId: opportunity.id,
      conversionType: 'PARTNER',
    });
    await runWebhookDispatch(deps);
    const converted = JSON.parse(webhookSender.requests[1]!.body);
    expect(converted).toMatchObject({
      type: 'lead.converted',
      data: {
        opportunity: { status: 'WON', conversionType: 'PARTNER' },
        lead: { references: [{ system: 'DOCLINE_CRM', externalId: 'CRM-778' }] },
      },
    });
    // Nada a enviar: a rodada não faz requisição.
    expect(await runWebhookDispatch(deps)).toMatchObject({ sent: 0 });
  });

  it('Não Contatar compartilhada: um evento por opt-out, valores mascarados', async () => {
    await endpoint(['optout.registered', 'suppression.revoked']);
    const lead = await createLead(deps, sdr, make('Escritório Fictício Jatobá'));
    await registerOptOut(deps, sdr, { leadId: lead.id });

    const events = await db.outboundEvent.findMany({ where: { type: 'optout.registered' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.leadId).toBe(lead.id);
    const data = events[0]!.payload as {
      suppressions: { type: string; source: string; valueMasked: string }[];
      leads: { id: string }[];
    };
    expect(data.suppressions.map((s) => s.type).sort()).toEqual(['LEAD', 'PHONE']);
    expect(data.suppressions.every((s) => s.source === 'SDR')).toBe(true);
    expect(data.leads.map((l) => l.id)).toEqual([lead.id]);
    expect(JSON.stringify(data)).not.toContain(`99733-${phone}`);

    // Inclusão manual de um número sem lead e revogação: eventos próprios.
    const added = await addSuppression(deps, admin, {
      type: 'EMAIL',
      value: 'contato.ficticio@example.com',
      reason: 'OPT_OUT',
    });
    expect(added.created).toBe(true);
    const manual = await db.outboundEvent.findFirstOrThrow({
      where: { type: 'optout.registered', leadId: null },
    });
    expect(manual.payload).toMatchObject({
      suppressions: [{ type: 'EMAIL', source: 'ADMIN' }],
      leads: [],
    });
    expect(JSON.stringify(manual.payload)).not.toContain('contato.ficticio@example.com');
    const entry = await db.suppressionEntry.findFirstOrThrow({ where: { type: 'EMAIL' } });
    await revokeSuppression(deps, admin, { suppressionId: entry.id, reason: 'Pedido do titular' });
    const revoked = await db.outboundEvent.findFirstOrThrow({
      where: { type: 'suppression.revoked' },
    });
    expect(JSON.stringify(revoked.payload)).not.toContain('Pedido do titular');

    await runWebhookDispatch(deps);
    expect(webhookSender.requests.map((r) => r.headers['docline-event'])).toEqual([
      'optout.registered',
      'optout.registered',
      'suppression.revoked',
    ]);
  });

  it('falha: novas tentativas em 1 min, 5 min… e FAILED depois de 8 envios', async () => {
    const { endpoint: crm } = await endpoint();
    await handoff('Escritório Fictício Cedro');
    webhookSender.respond(CRM_URL, { status: 503, body: 'Fora do ar\npara manutenção' });

    await runWebhookDispatch(deps);
    let delivery = await db.webhookDelivery.findFirstOrThrow();
    expect(delivery).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastStatusCode: 503,
      lastError: 'HTTP 503: Fora do ar para manutenção',
      nextAttemptAt: new Date(START.getTime() + 60_000),
    });
    // Antes da hora, nada.
    expect(await runWebhookDispatch(deps)).toMatchObject({ sent: 0 });

    for (const minutes of [1, 5, 30, 120, 360, 720, 1440]) {
      clock.advance(minutes * 60_000);
      expect(await runWebhookDispatch(deps)).toMatchObject({ sent: 1, failed: 1 });
    }
    delivery = await db.webhookDelivery.findFirstOrThrow();
    expect(delivery).toMatchObject({ status: 'FAILED', attempts: 8 });
    const health = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: crm.id } });
    expect(health).toMatchObject({ consecutiveFailures: 8, failingSince: START, status: 'ACTIVE' });

    // Reenvio manual: nova entrega do mesmo evento; a original fica no histórico.
    webhookSender.respond(CRM_URL, { status: 204 });
    const { deliveryId } = await resendWebhookDelivery(deps, admin, { deliveryId: delivery.id });
    await runWebhookDispatch(deps);
    expect(await db.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).toMatchObject(
      { status: 'SUCCEEDED', manual: true },
    );
    expect(
      await db.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).toMatchObject({ status: 'FAILED' });
    expect(await db.webhookEndpoint.findUniqueOrThrow({ where: { id: crm.id } })).toMatchObject({
      consecutiveFailures: 0,
      failingSince: null,
    });

    await handoff('Escritório Fictício Aroeira');
    const pending = await db.webhookDelivery.findFirstOrThrow({ where: { status: 'PENDING' } });
    await expect(resendWebhookDelivery(deps, admin, { deliveryId: pending.id })).rejects.toThrow(
      ConflictError,
    );
  });

  it('erro de rede ou endereço bloqueado conta como falha, com o motivo', async () => {
    await endpoint();
    await handoff('Escritório Fictício Angico');
    webhookSender.respond(CRM_URL, { error: 'BLOCKED' });
    await runWebhookDispatch(deps);
    expect(await db.webhookDelivery.findFirstOrThrow()).toMatchObject({
      status: 'PENDING',
      lastStatusCode: null,
      lastError: 'Falha simulada (BLOCKED).',
    });
  });

  it('desliga sozinho com 20 falhas em 24 h, avisa o ADMIN; reativar retoma a fila', async () => {
    const { endpoint: crm } = await endpoint();
    await db.webhookEndpoint.update({
      where: { id: crm.id },
      data: { consecutiveFailures: 19, failingSince: new Date(START.getTime() - 25 * 3_600_000) },
    });
    await handoff('Escritório Fictício Baraúna');
    webhookSender.respond(CRM_URL, { status: 500 });
    const result = await runWebhookDispatch(deps);
    expect(result.disabledEndpoints).toEqual([crm.id]);

    const disabled = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: crm.id } });
    expect(disabled).toMatchObject({ status: 'DISABLED', consecutiveFailures: 20 });
    expect(disabled.disabledReason).toMatch(/^20 falhas seguidas desde/);
    expect(
      await db.notification.count({ where: { userId: admin.id, type: 'webhook.disabled' } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: 'webhook_endpoint.auto_disable', actorType: 'SYSTEM' },
      }),
    ).toBe(1);

    // Desligado: novos eventos entram na fila, mas não saem.
    await handoff('Escritório Fictício Oiticica');
    clock.advance(60 * 60_000);
    expect(await runWebhookDispatch(deps)).toMatchObject({ sent: 0 });

    // O teste manual sai mesmo com o destino fora (para conferir a correção).
    webhookSender.respond(CRM_URL, { status: 200 });
    await sendTestWebhook(deps, admin, { endpointId: crm.id });
    expect(await runWebhookDispatch(deps)).toMatchObject({ sent: 1, succeeded: 1 });
    expect(JSON.parse(webhookSender.requests.at(-1)!.body)).toMatchObject({
      type: 'webhook.test',
      data: { endpoint: { id: crm.id } },
    });

    // Reativar zera a contagem e envia o que ficou guardado.
    const reactivated = await setWebhookEndpointStatus(deps, admin, {
      endpointId: crm.id,
      status: 'ACTIVE',
    });
    expect(reactivated).toMatchObject({
      status: 'ACTIVE',
      consecutiveFailures: 0,
      disabledReason: null,
    });
    expect(await runWebhookDispatch(deps)).toMatchObject({ sent: 2, succeeded: 2 });
    const statuses = await listWebhookEndpoints(deps, admin, {});
    expect(statuses.data[0]).toMatchObject({ pendingDeliveries: 0, failedLastWeek: 0 });
  });

  it('pausado: entregas esperam; rotação troca o segredo na hora', async () => {
    const { endpoint: crm, secret } = await endpoint();
    await setWebhookEndpointStatus(deps, admin, { endpointId: crm.id, status: 'PAUSED' });
    await handoff('Escritório Fictício Sabiá');
    expect(await runWebhookDispatch(deps)).toMatchObject({ sent: 0 });

    const rotated = await rotateWebhookSecret(deps, admin, { endpointId: crm.id });
    expect(rotated.endpoint.secretVersion).toBe(2);
    expect(rotated.secret).not.toBe(secret);
    await setWebhookEndpointStatus(deps, admin, { endpointId: crm.id, status: 'ACTIVE' });
    await runWebhookDispatch(deps);
    const [request] = webhookSender.requests;
    const signature = request!.headers['docline-signature']!;
    expect(verifyWebhookSignature(rotated.secret, signature, request!.body, START)).toBe(true);
    expect(verifyWebhookSignature(secret, signature, request!.body, START)).toBe(false);

    const log = await listWebhookDeliveries(deps, admin, { endpointId: crm.id });
    expect(log.data).toHaveLength(1);
    expect(log.data[0]).toMatchObject({
      status: 'SUCCEEDED',
      eventLabel: 'Oportunidade criada',
      endpoint: { name: 'CRM Docline' },
    });
    expect(
      (await db.auditLog.findMany({ where: { entityType: 'webhook_endpoint' } })).map(
        (a) => a.action,
      ),
    ).toEqual([
      'webhook_endpoint.create',
      'webhook_endpoint.pause',
      'webhook_endpoint.rotate_secret',
      'webhook_endpoint.activate',
    ]);
  });

  it('limpeza: eventos com mais de 90 dias saem com as entregas', async () => {
    await endpoint();
    await handoff('Escritório Fictício Umbu');
    clock.advance(91 * 86_400_000);
    await handoff('Escritório Fictício Juazeiro');
    expect(await purgeOutboundEvents(deps)).toEqual({ deleted: 1 });
    expect(await db.outboundEvent.count()).toBe(1);
    expect(await db.webhookDelivery.count()).toBe(1);
  });
});
