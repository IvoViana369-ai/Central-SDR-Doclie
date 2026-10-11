import { describe, expect, it } from 'vitest';
import { forwardingReport, ipAddressOptions, requestMetaFrom } from './request-meta';

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

describe('forwardingReport (diagnóstico do X-Forwarded-For no primeiro deploy)', () => {
  const report = (xff: string | null, trusted: string[] = []) => {
    const headers = new Headers();
    if (xff !== null) headers.set('x-forwarded-for', xff);
    return forwardingReport(headers, ipAddressOptions(trusted));
  };

  it('um único IP: nada a configurar', () => {
    expect(report('203.0.113.7')).toMatchObject({
      ok: true,
      resolvedIp: '203.0.113.7',
      suggestedTrustedProxies: null,
    });
  });

  it('cadeia com proxy em faixa privada e sem TRUSTED_PROXIES: sugere a faixa', () => {
    const result = report('203.0.113.7, 10.214.3.9, 10.10.1.2');
    expect(result).toMatchObject({
      ok: false,
      resolvedIp: null,
      forwardedFor: ['203.0.113.7', '10.214.3.9', '10.10.1.2'],
      suggestedTrustedProxies: '10.0.0.0/8',
    });
    expect(result.message).toContain('TRUSTED_PROXIES=10.0.0.0/8');
  });

  it('a sugestão aplicada resolve o IP do cliente', () => {
    const suggestion = report('203.0.113.7, 100.64.0.9').suggestedTrustedProxies!;
    expect(suggestion).toBe('100.64.0.0/10');
    expect(report('203.0.113.7, 100.64.0.9', suggestion.split(','))).toMatchObject({
      ok: true,
      resolvedIp: '203.0.113.7',
    });
  });

  it('IP público depois do primeiro item: não sugere nada (pede conferência)', () => {
    expect(report('203.0.113.7, 198.51.100.4')).toMatchObject({
      ok: false,
      suggestedTrustedProxies: null,
    });
  });

  it('sem cabeçalho ou com valor inválido: não sugere nada', () => {
    expect(report(null)).toMatchObject({
      ok: false,
      forwardedFor: [],
      suggestedTrustedProxies: null,
    });
    expect(report('lixo')).toMatchObject({ ok: false, suggestedTrustedProxies: null });
  });
});
