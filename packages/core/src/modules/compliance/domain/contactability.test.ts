import { describe, expect, it } from 'vitest';
import { evaluateAllChannels, evaluateChannel, type GateInput } from './contactability';

const since = new Date('2026-10-12T15:00:00Z');
const mobile = {
  id: 'cel',
  type: 'PHONE' as const,
  phoneKind: 'MOBILE' as const,
  whatsappStatus: 'UNKNOWN' as const,
  suppressions: [],
};
const landline = { ...mobile, id: 'fixo', phoneKind: 'LANDLINE' as const };
const email = { ...mobile, id: 'email', type: 'EMAIL' as const, phoneKind: null };

const base: GateInput = {
  leadStatus: 'ACTIVE',
  legalBasis: 'LEGITIMATE_INTEREST',
  channelPermissions: [],
  organizationSuppressions: [],
  contactPoints: [mobile, landline, email],
};

describe('gate de contactabilidade', () => {
  it('libera os canais com base legal e contato ativo', () => {
    const results = evaluateAllChannels(base);
    expect(results.map((r) => [r.channel, r.allowed])).toEqual([
      ['WHATSAPP', true],
      ['PHONE', true],
      ['EMAIL', true],
      ['INSTAGRAM', false],
    ]);
    expect(results[0]?.usableContactPointIds).toEqual(['cel']);
    expect(results[1]?.usableContactPointIds).toEqual(['cel', 'fixo']);
    expect(results[3]?.reasons).toEqual(['Nenhum Instagram cadastrado.']);
  });

  it('telefone identificado não é autorização: sem base legal, nada é liberado', () => {
    const results = evaluateAllChannels({ ...base, legalBasis: 'NOT_ASSESSED' });
    expect(results.every((r) => !r.allowed)).toBe(true);
    expect(results[0]?.reasons).toContain('Sem base legal registrada para este canal.');
  });

  it('permissão do canal sobrepõe a geral', () => {
    const input: GateInput = {
      ...base,
      legalBasis: 'NOT_ASSESSED',
      channelPermissions: [{ channel: 'EMAIL', legalBasis: 'CONSENT', optInStatus: 'NONE' }],
    };
    expect(evaluateChannel(input, 'EMAIL').allowed).toBe(true);
    expect(evaluateChannel(input, 'PHONE').allowed).toBe(false);
  });

  it('opt-out do lead em um canal bloqueia só aquele canal, com data e motivo', () => {
    const input: GateInput = {
      ...base,
      organizationSuppressions: [{ reason: 'OPT_OUT', scope: 'WHATSAPP', createdAt: since }],
    };
    const whatsapp = evaluateChannel(input, 'WHATSAPP');
    expect(whatsapp.allowed).toBe(false);
    expect(whatsapp.reasons).toEqual([
      'Lead na Lista Não Contatar desde 12/10/2026 (pediu para não ser contatado).',
    ]);
    expect(evaluateChannel(input, 'PHONE').allowed).toBe(true);
  });

  it('contato suprimido não é usado; se não sobra nenhum, o canal fica bloqueado', () => {
    const suppressed = {
      ...mobile,
      suppressions: [
        { reason: 'COMPLAINT' as const, scope: 'ALL_CHANNELS' as const, createdAt: since },
      ],
    };
    const input: GateInput = { ...base, contactPoints: [suppressed, landline, email] };
    expect(evaluateChannel(input, 'PHONE').usableContactPointIds).toEqual(['fixo']);
    const whatsapp = evaluateChannel(input, 'WHATSAPP');
    expect(whatsapp.allowed).toBe(false);
    expect(whatsapp.reasons[0]).toContain(
      'Contato na Lista Não Contatar desde 12/10/2026 (reclamação)',
    );
  });

  it('WhatsApp: fixo marcado como provável vale; celular marcado como "não usa" não vale', () => {
    const input: GateInput = {
      ...base,
      contactPoints: [
        { ...mobile, whatsappStatus: 'NOT_ON_WHATSAPP' },
        { ...landline, whatsappStatus: 'PROBABLE' },
      ],
    };
    expect(evaluateChannel(input, 'WHATSAPP').usableContactPointIds).toEqual(['fixo']);
  });

  it('modo API exige opt-in de plataforma no WhatsApp; o modo assistido não', () => {
    expect(evaluateChannel(base, 'WHATSAPP', 'API').reasons).toContain(
      'Sem opt-in de plataforma (exigido para envio pela API do WhatsApp).',
    );
    const withOptIn: GateInput = {
      ...base,
      channelPermissions: [{ channel: 'WHATSAPP', legalBasis: 'CONSENT', optInStatus: 'GRANTED' }],
    };
    expect(evaluateChannel(withOptIn, 'WHATSAPP', 'API').allowed).toBe(true);
  });

  it('lead arquivado não é contatado', () => {
    expect(evaluateChannel({ ...base, leadStatus: 'ARCHIVED' }, 'PHONE').reasons).toEqual([
      'Lead arquivado.',
    ]);
  });
});
