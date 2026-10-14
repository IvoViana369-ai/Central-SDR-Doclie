import { describe, expect, it } from 'vitest';
import { computeContactStatus, type MatchedSuppression } from './contact-status';

const optOut: MatchedSuppression = { reason: 'OPT_OUT', scope: 'ALL_CHANNELS' };
const complaint: MatchedSuppression = { reason: 'COMPLAINT', scope: 'ALL_CHANNELS' };
const whatsappOnly: MatchedSuppression = { reason: 'OPT_OUT', scope: 'WHATSAPP' };
const clean = { suppressions: [] };

describe('computeContactStatus', () => {
  it('contactável: base legal e ao menos um contato sem restrição', () => {
    expect(
      computeContactStatus({
        legalBasis: 'LEGITIMATE_INTEREST',
        organizationSuppressions: [],
        contactPoints: [clean],
      }),
    ).toBe('CONTACTABLE');
  });

  it('sem base legal (ou "não avaliada") bloqueia o contato', () => {
    for (const legalBasis of [null, 'NOT_ASSESSED'] as const) {
      expect(
        computeContactStatus({ legalBasis, organizationSuppressions: [], contactPoints: [clean] }),
      ).toBe('NO_LEGAL_BASIS');
    }
  });

  it('supressão do lead ou do CNPJ vale para a organização inteira, acima da base legal', () => {
    expect(
      computeContactStatus({
        legalBasis: 'NOT_ASSESSED',
        organizationSuppressions: [optOut],
        contactPoints: [clean],
      }),
    ).toBe('OPTED_OUT');
    expect(
      computeContactStatus({
        legalBasis: 'CONSENT',
        organizationSuppressions: [complaint],
        contactPoints: [clean],
      }),
    ).toBe('BLOCKED');
  });

  it('supressão de um contato só restringe; sem contato utilizável, o lead fica bloqueado', () => {
    expect(
      computeContactStatus({
        legalBasis: 'CONSENT',
        organizationSuppressions: [],
        contactPoints: [{ suppressions: [optOut] }, clean],
      }),
    ).toBe('RESTRICTED');
    expect(
      computeContactStatus({
        legalBasis: 'CONSENT',
        organizationSuppressions: [],
        contactPoints: [{ suppressions: [optOut] }],
      }),
    ).toBe('OPTED_OUT');
    expect(
      computeContactStatus({
        legalBasis: 'CONSENT',
        organizationSuppressions: [],
        contactPoints: [{ suppressions: [complaint] }],
      }),
    ).toBe('BLOCKED');
  });

  it('supressão restrita a um canal deixa o lead restrito', () => {
    expect(
      computeContactStatus({
        legalBasis: 'CONSENT',
        organizationSuppressions: [whatsappOnly],
        contactPoints: [clean],
      }),
    ).toBe('RESTRICTED');
  });

  it('sem nenhum contato ativo, o lead fica restrito', () => {
    expect(
      computeContactStatus({
        legalBasis: 'CONSENT',
        organizationSuppressions: [],
        contactPoints: [],
      }),
    ).toBe('RESTRICTED');
  });
});
