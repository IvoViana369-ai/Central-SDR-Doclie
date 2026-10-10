import { describe, expect, it } from 'vitest';
import { ipAddressOptions, requestMetaFrom } from './request-meta';

const meta = (xff: string | null, trusted: string[] = []) => {
  const headers = new Headers({ 'user-agent': 'teste' });
  if (xff !== null) headers.set('x-forwarded-for', xff);
  return requestMetaFrom(headers, ipAddressOptions(trusted));
};

describe('requestMetaFrom (IP para auditoria)', () => {
  it('aceita um X-Forwarded-For com um único IP', () => {
    expect(meta('203.0.113.7').ip).toBe('203.0.113.7');
  });

  it('nunca usa o primeiro item de uma cadeia (pode ser forjado pelo cliente)', () => {
    expect(meta('6.6.6.6, 203.0.113.7').ip).not.toBe('6.6.6.6');
  });

  it('com proxies confiáveis, usa o primeiro salto não confiável a partir da direita', () => {
    expect(meta('6.6.6.6, 203.0.113.7, 10.1.2.3', ['10.0.0.0/8']).ip).toBe('203.0.113.7');
  });

  it('ignora X-Real-IP (o cliente pode enviá-lo)', () => {
    const headers = new Headers({ 'x-real-ip': '6.6.6.6' });
    expect(requestMetaFrom(headers, ipAddressOptions([])).ip).not.toBe('6.6.6.6');
  });

  it('gera requestId e limita o user agent', () => {
    const result = meta('203.0.113.7');
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.userAgent).toBe('teste');
  });
});
