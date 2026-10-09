import { describe, expect, it } from 'vitest';
import type { ScoreFacts } from './criteria';
import {
  bandOf,
  computeScore,
  validateBands,
  type BandRange,
  type ScoringModelInput,
} from './score';

const BANDS: BandRange[] = [
  { band: 'COLD', min: 0, max: 30 },
  { band: 'WARM', min: 31, max: 60 },
  { band: 'HOT', min: 61, max: 80 },
  { band: 'PRIORITY', min: 81, max: 100 },
];

const facts = (overrides: Partial<ScoreFacts> = {}): ScoreFacts => ({
  hasWhatsapp: false,
  hasInstagram: false,
  hasWebsite: false,
  hasEmail: false,
  hasPhone: false,
  hasCnpj: false,
  stateUf: 'CE',
  inPriorityCity: false,
  leadType: 'ACCOUNTING_FIRM',
  tagIds: [],
  repliedBefore: false,
  showedInterest: false,
  instagramLastPostAt: null,
  googleReviewsCount: null,
  ...overrides,
});

/** Modelo inicial do §8.2 (Google e Instagram ativo inativos). */
const V1: ScoringModelInput = {
  normalization: 'CLAMP',
  bands: BANDS,
  rules: [
    { criterionKey: 'has_whatsapp', params: {}, points: 20, active: true },
    { criterionKey: 'has_instagram', params: {}, points: 15, active: true },
    { criterionKey: 'has_website', params: {}, points: 10, active: true },
    { criterionKey: 'google_reviews_gte', params: { min: 1 }, points: 10, active: false },
    {
      criterionKey: 'instagram_active',
      params: { maxDaysSincePost: 30 },
      points: 10,
      active: false,
    },
    { criterionKey: 'in_priority_city', params: {}, points: 15, active: true },
    { criterionKey: 'replied_before', params: {}, points: 20, active: true },
    { criterionKey: 'showed_interest', params: {}, points: 30, active: true },
  ],
};
const now = new Date('2026-10-13T12:00:00Z');

describe('lead scoring (M07)', () => {
  it('soma os pontos dos critérios atendidos e explica cada um', () => {
    const result = computeScore(V1, facts({ hasWhatsapp: true, hasWebsite: true }), now);
    expect(result).toMatchObject({ score: 30, band: 'COLD', raw: 30 });
    // Regras inativas ficam de fora da explicação.
    expect(result.breakdown.map((b) => b.criterion)).toEqual([
      'has_whatsapp',
      'has_instagram',
      'has_website',
      'in_priority_city',
      'replied_before',
      'showed_interest',
    ]);
    expect(result.breakdown[0]).toMatchObject({
      label: 'Tem WhatsApp',
      matched: true,
      points: 20,
      weight: 20,
      detail: 'WhatsApp provável ou confirmado.',
    });
    expect(result.breakdown[1]).toMatchObject({ matched: false, points: 0, weight: 15 });
  });

  it('CLAMP: teto de 100 e piso de 0 (pontos negativos)', () => {
    const all = facts({
      hasWhatsapp: true,
      hasInstagram: true,
      hasWebsite: true,
      inPriorityCity: true,
      repliedBefore: true,
      showedInterest: true,
    });
    expect(computeScore(V1, all, now)).toMatchObject({ score: 100, raw: 110, band: 'PRIORITY' });
    const negative: ScoringModelInput = {
      ...V1,
      rules: [{ criterionKey: 'has_cnpj', params: {}, points: -20, active: true }],
    };
    expect(computeScore(negative, facts({ hasCnpj: true }), now)).toMatchObject({
      score: 0,
      raw: -20,
    });
  });

  it('SCALE: proporcional entre o mínimo e o máximo possíveis', () => {
    const scaled: ScoringModelInput = {
      normalization: 'SCALE',
      bands: BANDS,
      rules: [
        { criterionKey: 'has_whatsapp', params: {}, points: 150, active: true },
        { criterionKey: 'has_email', params: {}, points: 50, active: true },
        { criterionKey: 'has_cnpj', params: {}, points: -50, active: true },
      ],
    };
    // Máximo 200, mínimo -50: 150 de 250 → 80.
    expect(computeScore(scaled, facts({ hasWhatsapp: true }), now)).toMatchObject({
      score: 80,
      band: 'HOT',
    });
    expect(computeScore(scaled, facts({ hasCnpj: true }), now).score).toBe(0);
  });

  it('critério com parâmetros (UF, tipo, tag, Instagram ativo)', () => {
    const model: ScoringModelInput = {
      normalization: 'CLAMP',
      bands: BANDS,
      rules: [
        { criterionKey: 'in_state', params: { ufs: ['CE', 'PI'] }, points: 10, active: true },
        {
          criterionKey: 'lead_type_in',
          params: { types: ['ACCOUNTANT'] },
          points: 10,
          active: true,
        },
        {
          criterionKey: 'has_tag',
          params: { tagId: '0191b6b4-1f2a-7c3d-8e4f-5a6b7c8d9e0f' },
          points: 10,
          active: true,
        },
        {
          criterionKey: 'instagram_active',
          params: { maxDaysSincePost: 30 },
          points: 10,
          active: true,
        },
      ],
    };
    const result = computeScore(
      model,
      facts({
        tagIds: ['0191b6b4-1f2a-7c3d-8e4f-5a6b7c8d9e0f'],
        instagramLastPostAt: new Date('2026-10-01T12:00:00Z'),
      }),
      now,
    );
    expect(result.breakdown.map((b) => [b.label, b.matched])).toEqual([
      ['Em CE, PI', true],
      ['Tipo: ACCOUNTANT', false],
      ['Tem a tag escolhida', true],
      ['Publicou no Instagram nos últimos 30 dias', true],
    ]);
    expect(result.score).toBe(30);
  });

  it('critério desconhecido ou com parâmetros inválidos é ignorado (não quebra o cálculo)', () => {
    const model: ScoringModelInput = {
      normalization: 'CLAMP',
      bands: BANDS,
      rules: [
        { criterionKey: 'removido_do_codigo', params: {}, points: 50, active: true },
        { criterionKey: 'in_state', params: { ufs: 'CE' }, points: 50, active: true },
        { criterionKey: 'has_email', params: {}, points: 40, active: true },
      ],
    };
    const result = computeScore(model, facts({ hasEmail: true }), now);
    expect(result).toMatchObject({ score: 40, band: 'WARM' });
    expect(result.breakdown).toHaveLength(1);
  });

  it('faixas: cobrem 0–100 em ordem, sem buraco nem sobreposição', () => {
    expect(validateBands(BANDS)).toEqual([]);
    expect(bandOf(30, BANDS)).toBe('COLD');
    expect(bandOf(31, BANDS)).toBe('WARM');
    expect(bandOf(81, BANDS)).toBe('PRIORITY');
    expect(
      validateBands([
        { band: 'COLD', min: 0, max: 30 },
        { band: 'WARM', min: 35, max: 60 },
        { band: 'HOT', min: 61, max: 80 },
        { band: 'PRIORITY', min: 81, max: 99 },
      ]),
    ).toEqual([
      'A última faixa termina em 100.',
      'Morno deve começar em 31 (logo depois de Frio).',
    ]);
    expect(validateBands(BANDS.slice(0, 3))).toHaveLength(1);
  });
});
