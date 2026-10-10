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
    expect(results.map((r) => r.codes)).toEqual([[], [], [], ['NO_CONTACT']]);
  });

  it('cada motivo tem o seu código (as campanhas contam por motivo)', () => {
    expect(evaluateChannel({ ...base, legalBasis: null }, 'WHATSAPP').codes).toEqual([
      'NO_LEGAL_BASIS',
    ]);
    expect(evaluateChannel({ ...base, leadStatus: 'ARCHIVED' }, 'PHONE').codes).toEqual([
      'LEAD_NOT_ACTIVE',
    ]);
    expect(
      evaluateChannel(
        {
          ...base,
          organizationSuppressions: [
            { reason: 'OPT_OUT', scope: 'ALL_CHANNELS', createdAt: since },
          ],
        },
        'EMAIL',
      ).codes,
    ).toEqual(['SUPPRESSED']);
    expect(
      evaluateChannel(
        {
          ...base,
          contactPoints: [
            {
              ...email,
              suppressions: [{ reason: 'OPT_OUT', scope: 'ALL_CHANNELS', createdAt: since }],
            },
          ],
        },
        'EMAIL',
      ).codes,
    ).toEqual(['CONTACT_SUPPRESSED']);
    expect(evaluateChannel(base, 'WHATSAPP', 'API').codes).toEqual(['NO_OPT_IN']);
    expect(
      evaluateChannel(
        { ...base, contactPoints: [{ ...email, id: 'ig', type: 'INSTAGRAM' as const }] },
        'INSTAGRAM',
        'API',
      ).codes,
    ).toEqual(['NO_SERVICE_WINDOW']);
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

  it('lead inteiro na lista: o motivo não se repete com contato, base legal ou e-mail ausente', () => {
    const optOut = { reason: 'OPT_OUT' as const, scope: 'ALL_CHANNELS' as const, createdAt: since };
    const input: GateInput = {
      ...base,
      leadStatus: 'ARCHIVED',
      legalBasis: null,
      organizationSuppressions: [optOut],
      contactPoints: [{ ...mobile, suppressions: [optOut] }],
    };
    for (const channel of ['WHATSAPP', 'EMAIL'] as const) {
      const result = evaluateChannel(input, channel);
      expect(result.allowed).toBe(false);
      expect(result.reasons).toEqual([
        'Lead arquivado.',
        'Lead na Lista Não Contatar desde 12/10/2026 (pediu para não ser contatado).',
      ]);
      expect(result.usableContactPointIds).toEqual([]);
    }
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

  it('modo API do WhatsApp: só números com opt-in ou com a janela aberta; o assistido não exige', () => {
    expect(evaluateChannel(base, 'WHATSAPP').allowed).toBe(true);
    expect(evaluateChannel(base, 'WHATSAPP', 'API').reasons).toEqual([
      'Nenhum número com opt-in registrado nem conversa aberta pelo contato nas últimas 24 h (exigido para enviar pela API do WhatsApp).',
    ]);
    // Opt-in no nível do lead (Fase 2) não libera a API: a permissão é do número.
    const leadLevel: GateInput = {
      ...base,
      channelPermissions: [{ channel: 'WHATSAPP', legalBasis: 'CONSENT', optInStatus: 'GRANTED' }],
    };
    expect(evaluateChannel(leadLevel, 'WHATSAPP', 'API').allowed).toBe(false);

    const second = { ...mobile, id: 'cel2' };
    const perNumber: GateInput = {
      ...base,
      contactPoints: [mobile, { ...second, whatsappOptIn: true }],
    };
    expect(evaluateChannel(perNumber, 'WHATSAPP', 'API')).toMatchObject({
      allowed: true,
      usableContactPointIds: ['cel2'],
    });
    const window: GateInput = {
      ...base,
      contactPoints: [{ ...mobile, serviceWindowOpen: true }],
    };
    expect(evaluateChannel(window, 'WHATSAPP', 'API').usableContactPointIds).toEqual(['cel']);
    // Lista Não Contatar continua valendo mesmo com opt-in.
    const suppressed: GateInput = {
      ...base,
      contactPoints: [
        {
          ...mobile,
          whatsappOptIn: true,
          suppressions: [{ reason: 'OPT_OUT', scope: 'WHATSAPP', createdAt: since }],
        },
      ],
    };
    expect(evaluateChannel(suppressed, 'WHATSAPP', 'API').allowed).toBe(false);
  });

  it('modo API do Instagram: só responde a quem escreveu nas últimas 24 h', () => {
    const instagram = {
      ...mobile,
      id: 'ig',
      type: 'INSTAGRAM' as const,
      phoneKind: null,
    };
    const input: GateInput = { ...base, contactPoints: [instagram] };
    // No assistido (copiar e abrir o perfil), o @ basta.
    expect(evaluateChannel(input, 'INSTAGRAM').allowed).toBe(true);
    expect(evaluateChannel(input, 'INSTAGRAM', 'API').reasons).toEqual([
      'O contato não escreveu para a Docline no Instagram nas últimas 24 h: pela API só dá para responder (o primeiro contato é pelo app).',
    ]);
    const open: GateInput = { ...base, contactPoints: [{ ...instagram, serviceWindowOpen: true }] };
    expect(evaluateChannel(open, 'INSTAGRAM', 'API')).toMatchObject({
      allowed: true,
      usableContactPointIds: ['ig'],
    });
    // Lista Não Contatar continua valendo dentro da janela.
    const suppressed: GateInput = {
      ...base,
      contactPoints: [
        {
          ...instagram,
          serviceWindowOpen: true,
          suppressions: [{ reason: 'OPT_OUT', scope: 'INSTAGRAM', createdAt: since }],
        },
      ],
    };
    expect(evaluateChannel(suppressed, 'INSTAGRAM', 'API').allowed).toBe(false);
  });

  it('lead arquivado não é contatado', () => {
    expect(evaluateChannel({ ...base, leadStatus: 'ARCHIVED' }, 'PHONE').reasons).toEqual([
      'Lead arquivado.',
    ]);
  });
});
