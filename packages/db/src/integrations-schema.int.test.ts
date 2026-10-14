import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDb, getTestDb, resetTestData } from '../test/helpers';

const db = getTestDb();
const at = (iso: string) => new Date(iso);

async function createEndpoint(events: string[] = ['lead.converted']) {
  return db.webhookEndpoint.create({
    data: { name: 'CRM fictício', url: 'https://crm.example.com/webhooks', events },
  });
}

async function createEvent(type = 'lead.converted') {
  return db.outboundEvent.create({
    data: { type, occurredAt: at('2026-10-14T12:00:00Z'), payload: { data: {} } },
  });
}

describe('schema de integrações (Fase 12)', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('chave de API: prefixo e hash únicos, ao menos um escopo e limite dentro da faixa', async () => {
    const key = await db.apiKey.create({
      data: {
        name: 'CRM',
        prefix: 'dsdr_aaaa1111',
        keyHash: 'a'.repeat(64),
        scopes: ['leads:read'],
      },
    });
    expect(key.rateLimitPerMinute).toBe(120);
    expect(key.revokedAt).toBeNull();

    await expect(
      db.apiKey.create({
        data: { name: 'Outra', prefix: 'dsdr_aaaa1111', keyHash: 'b'.repeat(64), scopes: ['x'] },
      }),
    ).rejects.toThrow();
    await expect(
      db.apiKey.create({
        data: { name: 'Outra', prefix: 'dsdr_bbbb2222', keyHash: 'a'.repeat(64), scopes: ['x'] },
      }),
    ).rejects.toThrow();
    await expect(
      db.apiKey.create({
        data: { name: 'Sem escopo', prefix: 'dsdr_cccc3333', keyHash: 'c'.repeat(64), scopes: [] },
      }),
    ).rejects.toThrow(/api_keys_scopes_present/);
    await expect(
      db.apiKey.create({
        data: {
          name: 'Limite',
          prefix: 'dsdr_dddd4444',
          keyHash: 'd'.repeat(64),
          scopes: ['leads:read'],
          rateLimitPerMinute: 0,
        },
      }),
    ).rejects.toThrow(/api_keys_rate_limit_range/);
  });

  it('destino de webhook: eventos obrigatórios e URL http(s)', async () => {
    const endpoint = await createEndpoint();
    expect(endpoint.status).toBe('ACTIVE');
    expect(endpoint.secretVersion).toBe(1);
    expect(endpoint.consecutiveFailures).toBe(0);

    await expect(createEndpoint([])).rejects.toThrow(/webhook_endpoints_events_present/);
    await expect(
      db.webhookEndpoint.create({
        data: { name: 'FTP', url: 'ftp://crm.example.com', events: ['lead.converted'] },
      }),
    ).rejects.toThrow(/webhook_endpoints_url_http/);
  });

  it('entregas: várias por evento (reenvio) e somem com o destino ou com o evento', async () => {
    const endpoint = await createEndpoint();
    const event = await createEvent();
    const first = await db.webhookDelivery.create({
      data: { endpointId: endpoint.id, eventId: event.id, nextAttemptAt: event.occurredAt },
    });
    expect(first.status).toBe('PENDING');
    expect(first.attempts).toBe(0);
    await db.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventId: event.id,
        nextAttemptAt: event.occurredAt,
        manual: true,
      },
    });
    expect(await db.webhookDelivery.count({ where: { eventId: event.id } })).toBe(2);

    await db.webhookEndpoint.delete({ where: { id: endpoint.id } });
    expect(await db.webhookDelivery.count()).toBe(0);
    expect(await db.outboundEvent.count()).toBe(1);

    const other = await createEndpoint();
    await db.webhookDelivery.create({
      data: { endpointId: other.id, eventId: event.id, nextAttemptAt: event.occurredAt },
    });
    await db.outboundEvent.delete({ where: { id: event.id } });
    expect(await db.webhookDelivery.count()).toBe(0);
  });

  it('referências externas: um vínculo por registro e sistema; um id externo, um registro', async () => {
    const leadA = randomUUID();
    const leadB = randomUUID();
    const base = { entityType: 'LEAD' as const, syncedAt: at('2026-10-14T12:00:00Z') };
    await db.externalReference.create({
      data: { ...base, entityId: leadA, system: 'DOCLINE_CRM', externalId: 'CRM-1' },
    });
    // Mesmo lead, outro sistema: pode.
    await db.externalReference.create({
      data: { ...base, entityId: leadA, system: 'GESTAO_AR', externalId: 'AR-9' },
    });
    // Mesmo id externo, como oportunidade: pode (tipos diferentes).
    await db.externalReference.create({
      data: {
        ...base,
        entityType: 'OPPORTUNITY',
        entityId: randomUUID(),
        system: 'DOCLINE_CRM',
        externalId: 'CRM-1',
      },
    });

    await expect(
      db.externalReference.create({
        data: { ...base, entityId: leadA, system: 'DOCLINE_CRM', externalId: 'CRM-2' },
      }),
    ).rejects.toThrow();
    await expect(
      db.externalReference.create({
        data: { ...base, entityId: leadB, system: 'DOCLINE_CRM', externalId: 'CRM-1' },
      }),
    ).rejects.toThrow();
    await expect(
      db.externalReference.create({
        data: { ...base, entityId: leadB, system: 'crm minúsculo', externalId: 'X' },
      }),
    ).rejects.toThrow(/external_references_system_code/);
    await expect(
      db.externalReference.create({
        data: { ...base, entityId: leadB, system: 'DOCLINE_CRM', externalId: '' },
      }),
    ).rejects.toThrow(/external_references_external_id_length/);
  });

  it('Lista Não Contatar aceita a origem INTEGRATION', async () => {
    const entry = await db.suppressionEntry.create({
      data: {
        type: 'PHONE',
        valueHash: 'f'.repeat(64),
        valueMasked: '+55 88 9****-0000',
        reason: 'OPT_OUT',
        source: 'INTEGRATION',
      },
    });
    expect(entry.source).toBe('INTEGRATION');
  });
});
