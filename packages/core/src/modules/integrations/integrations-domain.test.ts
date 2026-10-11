import { describe, expect, it } from 'vitest';
import {
  API_KEY_PATTERN,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_ATTEMPTS,
  apiKeyPrefix,
  buildWebhookBody,
  checkAddress,
  deliveryErrorText,
  isDeliverySuccess,
  nextAttemptAt,
  shouldDisableEndpoint,
  systemLabel,
  validateWebhookUrl,
  webhookEventLabel,
} from './domain';
import {
  deriveWebhookSecret,
  generateApiKey,
  hashApiKey,
  signWebhook,
  verifyWebhookSignature,
} from './domain/signing';

const PROD = { allowPrivateNetworks: false };
const DEV = { allowPrivateNetworks: true };

describe('proteção contra SSRF', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00:ec2::254',
    'fc00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::10.0.0.1',
    '[::1]',
  ])('bloqueia %s em produção', (ip) => {
    expect(checkAddress(ip, PROD).ok).toBe(false);
  });

  it.each(['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'aceita o endereço público %s',
    (ip) => {
      expect(checkAddress(ip, PROD)).toEqual({ ok: true });
    },
  );

  it('rede interna só com a política de desenvolvimento; IP inválido nunca', () => {
    expect(checkAddress('127.0.0.1', DEV)).toEqual({ ok: true });
    expect(checkAddress('999.1.1.1', DEV).ok).toBe(false);
    expect(checkAddress('1:2:3', DEV).ok).toBe(false);
    expect(checkAddress('example.com', DEV).ok).toBe(false);
  });

  it('diz o motivo do bloqueio', () => {
    expect(checkAddress('169.254.169.254', PROD)).toEqual({
      ok: false,
      reason: 'link-local (inclui metadados de nuvem)',
    });
  });

  it('URL do destino: https, sem credenciais nem fragmento, host público', () => {
    expect(validateWebhookUrl('https://crm.example.com/hooks/sdr', PROD).ok).toBe(true);
    expect(validateWebhookUrl('http://crm.example.com/hooks', PROD)).toEqual({
      ok: false,
      message: 'Use uma URL https://.',
    });
    expect(validateWebhookUrl('ftp://crm.example.com', DEV).ok).toBe(false);
    expect(validateWebhookUrl('https://u:p@crm.example.com', PROD).ok).toBe(false);
    expect(validateWebhookUrl('https://crm.example.com/#x', PROD).ok).toBe(false);
    expect(validateWebhookUrl('https://localhost/hook', PROD).ok).toBe(false);
    expect(validateWebhookUrl('https://api.internal/hook', PROD).ok).toBe(false);
    expect(validateWebhookUrl('https://intranet/hook', PROD).ok).toBe(false);
    expect(validateWebhookUrl('https://169.254.169.254/latest', PROD).ok).toBe(false);
    expect(validateWebhookUrl('https://[::1]:8443/hook', PROD).ok).toBe(false);
    expect(validateWebhookUrl('não é url', PROD).ok).toBe(false);
    expect(validateWebhookUrl(`https://a.com/${'x'.repeat(2100)}`, PROD).ok).toBe(false);
    // Desenvolvimento e testes: receptor local por http.
    expect(validateWebhookUrl('http://127.0.0.1:4010/hook', DEV).ok).toBe(true);
    expect(validateWebhookUrl('http://localhost:4010/hook', DEV).ok).toBe(true);
  });
});

describe('webhooks de saída', () => {
  it('novas tentativas: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h e 24 h; depois desiste', () => {
    const t0 = new Date('2026-10-14T12:00:00Z');
    const delays = [1, 2, 3, 4, 5, 6, 7].map(
      (n) => (nextAttemptAt(n, t0)!.getTime() - t0.getTime()) / 60_000,
    );
    expect(delays).toEqual([1, 5, 30, 120, 360, 720, 1440]);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect(nextAttemptAt(8, t0)).toBeNull();
  });

  it('desliga o destino só com 20 falhas seguidas e 24 h falhando', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const day = new Date('2026-10-14T12:00:00Z');
    const hour = new Date('2026-10-15T11:00:00Z');
    expect(shouldDisableEndpoint({ consecutiveFailures: 20, failingSince: day }, now)).toBe(true);
    expect(shouldDisableEndpoint({ consecutiveFailures: 19, failingSince: day }, now)).toBe(false);
    expect(shouldDisableEndpoint({ consecutiveFailures: 300, failingSince: hour }, now)).toBe(
      false,
    );
    expect(shouldDisableEndpoint({ consecutiveFailures: 20, failingSince: null }, now)).toBe(false);
  });

  it('sucesso só com 2xx; erro curto e sem quebras de linha', () => {
    expect([200, 201, 204].every(isDeliverySuccess)).toBe(true);
    expect([301, 400, 500].some(isDeliverySuccess)).toBe(false);
    expect(deliveryErrorText(302, 'Location: x')).toBe('HTTP 302: redirecionamento não é seguido.');
    expect(deliveryErrorText(500, 'erro\n  interno')).toBe('HTTP 500: erro interno');
    expect(deliveryErrorText(null, '')).toBe('Falha de rede.');
    expect(deliveryErrorText(400, 'x'.repeat(500)).length).toBeLessThanOrEqual(300);
  });

  it('catálogo: eventos de oportunidade e da Lista Não Contatar, com rótulos', () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      'opportunity.created',
      'opportunity.accepted',
      'lead.converted',
      'opportunity.lost',
      'optout.registered',
      'suppression.revoked',
    ]);
    expect(webhookEventLabel('lead.converted')).toBe('Lead convertido');
    expect(webhookEventLabel('webhook.test')).toBe('Teste');
    expect(webhookEventLabel('outro.evento')).toBe('outro.evento');
  });

  it('corpo com id, tipo, data, versão e dados', () => {
    const body = buildWebhookBody({
      id: 'evt-1',
      type: 'lead.converted',
      occurredAt: new Date('2026-10-14T12:00:00Z'),
      data: { leadId: 'l-1' },
    });
    expect(JSON.parse(body)).toEqual({
      id: 'evt-1',
      type: 'lead.converted',
      occurredAt: '2026-10-14T12:00:00.000Z',
      apiVersion: '2026-10-14',
      data: { leadId: 'l-1' },
    });
  });

  it('assinatura HMAC: confere, recusa corpo alterado, outro segredo e timestamp velho', () => {
    const master = 'segredo-mestre-de-teste-com-mais-de-32-caracteres';
    const secret = deriveWebhookSecret(master, 'endpoint-1', 1);
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(deriveWebhookSecret(master, 'endpoint-1', 1)).toBe(secret);
    expect(deriveWebhookSecret(master, 'endpoint-1', 2)).not.toBe(secret);
    expect(deriveWebhookSecret(master, 'endpoint-2', 1)).not.toBe(secret);

    const at = new Date('2026-10-14T12:00:00Z');
    const body = '{"id":"evt-1"}';
    const header = signWebhook(secret, body, at);
    expect(header).toMatch(/^t=1791979200,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, header, body, at)).toBe(true);
    expect(verifyWebhookSignature(secret, header, '{"id":"evt-2"}', at)).toBe(false);
    expect(
      verifyWebhookSignature(deriveWebhookSecret(master, 'endpoint-1', 2), header, body, at),
    ).toBe(false);
    const late = new Date(at.getTime() + 301_000);
    expect(verifyWebhookSignature(secret, header, body, late)).toBe(false);
    expect(verifyWebhookSignature(secret, 'lixo', body, at)).toBe(false);
  });
});

describe('chaves de API', () => {
  it('formato dsdr_<prefixo>_<segredo>, prefixo visível e só o hash guardado', () => {
    const generated = generateApiKey();
    expect(generated.key).toMatch(API_KEY_PATTERN);
    expect(generated.prefix).toBe(generated.key.slice(0, 13));
    expect(apiKeyPrefix(generated.key)).toBe(generated.prefix);
    expect(generated.hash).toBe(hashApiKey(generated.key));
    expect(generated.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(generated.hash).not.toContain(generated.key.slice(14));
    expect(generateApiKey().key).not.toBe(generated.key);
    expect(apiKeyPrefix('Bearer qualquer')).toBeNull();
  });

  it('sistemas conhecidos ganham nome', () => {
    expect(systemLabel('DOCLINE_CRM')).toBe('CRM Docline');
    expect(systemLabel('OUTRO_SISTEMA')).toBe('OUTRO_SISTEMA');
    expect(systemLabel(null)).toBe('—');
  });
});
