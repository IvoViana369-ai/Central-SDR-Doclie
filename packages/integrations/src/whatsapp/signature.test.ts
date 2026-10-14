import { describe, expect, it } from 'vitest';
import { signMetaPayload, verifyMetaSignature, verifyWebhookChallenge } from './signature';

const SECRET = 'segredo-de-teste-nao-real';
const body = '{"object":"whatsapp_business_account","entry":[]}';

describe('assinatura dos webhooks da Meta', () => {
  it('aceita só o HMAC-SHA256 do corpo exato com o app secret', () => {
    const header = signMetaPayload(body, SECRET);
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyMetaSignature(body, header, SECRET)).toBe(true);
    expect(
      verifyMetaSignature(
        Buffer.from(body),
        header.toUpperCase().replace('SHA256', 'sha256'),
        SECRET,
      ),
    ).toBe(true);
    expect(verifyMetaSignature(`${body} `, header, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, header, 'outro-segredo')).toBe(false);
    expect(verifyMetaSignature(body, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'sha1=abc', SECRET)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=xyz', SECRET)).toBe(false);
  });

  it('verificação do endpoint devolve o desafio só com o token certo', () => {
    const params = (token: string, mode = 'subscribe') =>
      new URLSearchParams({ 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': '1234' });
    expect(verifyWebhookChallenge(params('token-certo'), 'token-certo')).toBe('1234');
    expect(verifyWebhookChallenge(params('token-errado'), 'token-certo')).toBeNull();
    expect(verifyWebhookChallenge(params('token-certo', 'unsubscribe'), 'token-certo')).toBeNull();
    expect(verifyWebhookChallenge(new URLSearchParams(), 'token-certo')).toBeNull();
  });
});
