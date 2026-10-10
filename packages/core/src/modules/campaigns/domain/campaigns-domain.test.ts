import { describe, expect, it } from 'vitest';
import {
  AB_MIN_SAMPLE,
  assignVariants,
  CAMPAIGN_STATUSES,
  buildFunnel,
  canEditSettings,
  canEditStructure,
  canTransition,
  compareVariants,
  countReasons,
  evaluateEligibility,
  holdsLeads,
  planDistribution,
  releaseQuota,
  twoProportionTest,
  type EligibilityInput,
  type FunnelCounts,
} from '.';

const now = new Date('2026-10-13T12:00:00Z');
const DAY = 86_400_000;

function eligibility(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    gateCodes: [],
    stageCategory: 'OPEN',
    hasOpenOpportunity: false,
    hasOngoingEnrollment: false,
    inOtherCampaign: false,
    lastContactAt: null,
    minDaysSinceLastContact: 30,
    ownedByOther: false,
    now,
    ...overrides,
  };
}

describe('elegibilidade da campanha', () => {
  it('lead sem impedimento é apto', () => {
    expect(evaluateEligibility(eligibility())).toEqual([]);
  });

  it('motivos do gate viram motivos da campanha; o horário não conta na montagem', () => {
    expect(
      evaluateEligibility(
        eligibility({ gateCodes: ['SUPPRESSED', 'NO_CONTACT', 'TIMING', 'NO_OPT_IN'] }),
      ),
    ).toEqual(['SUPPRESSED', 'NO_CHANNEL_CONTACT']);
    expect(evaluateEligibility(eligibility({ gateCodes: ['CONTACT_SUPPRESSED'] }))).toEqual([
      'CONTACT_SUPPRESSED',
    ]);
  });

  it('junta todos os motivos, sem repetir, na ordem da lista', () => {
    expect(
      evaluateEligibility(
        eligibility({
          gateCodes: ['NO_LEGAL_BASIS', 'LEAD_NOT_ACTIVE'],
          stageCategory: 'WON',
          hasOpenOpportunity: true,
          hasOngoingEnrollment: true,
          inOtherCampaign: true,
          lastContactAt: new Date(now.getTime() - 2 * DAY),
          ownedByOther: true,
        }),
      ),
    ).toEqual([
      'LEAD_NOT_ACTIVE',
      'NO_LEGAL_BASIS',
      'CLOSED_STAGE',
      'OPEN_OPPORTUNITY',
      'IN_CADENCE',
      'OTHER_CAMPAIGN',
      'RECENT_CONTACT',
      'OWNED_BY_OTHER',
    ]);
    expect(evaluateEligibility(eligibility({ stageCategory: 'LOST' }))).toEqual(['CLOSED_STAGE']);
    expect(evaluateEligibility(eligibility({ stageCategory: 'PARKED' }))).toEqual([]);
  });

  it('frequência: contato há menos dias que o mínimo impede; zero desliga a regra', () => {
    const recent = new Date(now.getTime() - 29 * DAY);
    const old = new Date(now.getTime() - 30 * DAY);
    expect(evaluateEligibility(eligibility({ lastContactAt: recent }))).toEqual(['RECENT_CONTACT']);
    expect(evaluateEligibility(eligibility({ lastContactAt: old }))).toEqual([]);
    expect(
      evaluateEligibility(eligibility({ lastContactAt: recent, minDaysSinceLastContact: 0 })),
    ).toEqual([]);
  });

  it('conta os motivos (um lead pode ter mais de um) e ignora o que não conhece', () => {
    expect(
      countReasons([
        { reasons: ['SUPPRESSED', 'RECENT_CONTACT'] },
        { reasons: ['SUPPRESSED'] },
        { reasons: ['DESCONHECIDO'] },
        { reasons: [] },
      ]),
    ).toEqual({ SUPPRESSED: 2, RECENT_CONTACT: 1 });
  });
});

describe('distribuição entre SDRs', () => {
  it('mantém o lead com o SDR da campanha e espalha o pool pela carga, em ordem de prioridade', () => {
    const plan = planDistribution(
      [
        { leadId: 'l1', ownerId: 'ana', priority: 10 },
        { leadId: 'l2', ownerId: 'ana', priority: 5 },
        { leadId: 'l3', ownerId: null, priority: 90 },
        { leadId: 'l4', ownerId: null, priority: 80 },
        { leadId: 'l5', ownerId: null, priority: 70 },
        { leadId: 'l6', ownerId: 'outra', priority: 99 },
      ],
      ['ana', 'bia'],
    );
    expect(Object.fromEntries(plan)).toEqual({
      l1: 'ana',
      l2: 'ana',
      l3: 'bia',
      l4: 'bia',
      // Empate de carga (2 a 2): vale a ordem da lista.
      l5: 'ana',
    });
    // Lead de quem não está na campanha não é tomado.
    expect(plan.has('l6')).toBe(false);
  });

  it('determinística: mesma entrada, mesmo resultado, qualquer que seja a ordem', () => {
    const leads = Array.from({ length: 9 }, (_, i) => ({
      leadId: `lead-${i}`,
      ownerId: null,
      priority: i % 3,
    }));
    const a = planDistribution(leads, ['x', 'y', 'z']);
    const b = planDistribution([...leads].reverse(), ['x', 'y', 'z']);
    expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b));
    const perSdr = [...a.values()].reduce<Record<string, number>>((acc, sdr) => {
      acc[sdr] = (acc[sdr] ?? 0) + 1;
      return acc;
    }, {});
    expect(perSdr).toEqual({ x: 3, y: 3, z: 3 });
  });

  it('sem SDR não distribui', () => {
    expect(planDistribution([{ leadId: 'l1', ownerId: null, priority: 1 }], []).size).toBe(0);
  });
});

describe('variantes do teste A/B', () => {
  const variants = [
    { id: 'vb', label: 'B' },
    { id: 'va', label: 'A' },
  ];

  it('alterna dentro da lista de cada SDR e gira o ponto de partida', () => {
    const plan = assignVariants(
      [
        { leadId: 'a1', assignedTo: 'ana', priority: 3 },
        { leadId: 'a2', assignedTo: 'ana', priority: 2 },
        { leadId: 'a3', assignedTo: 'ana', priority: 1 },
        { leadId: 'b1', assignedTo: 'bia', priority: 3 },
        { leadId: 'b2', assignedTo: 'bia', priority: 2 },
        { leadId: 'b3', assignedTo: 'bia', priority: 1 },
      ],
      variants,
    );
    expect(Object.fromEntries(plan)).toEqual({
      a1: 'va',
      a2: 'vb',
      a3: 'va',
      // A Bia começa onde a Ana parou: no total, 3 A e 3 B.
      b1: 'vb',
      b2: 'va',
      b3: 'vb',
    });
  });

  it('sem variantes, ninguém recebe abordagem sorteada', () => {
    expect(assignVariants([{ leadId: 'l', assignedTo: 'ana', priority: 1 }], []).size).toBe(0);
  });

  it('cota do dia nunca fica negativa', () => {
    expect(releaseQuota(20, 5)).toBe(15);
    expect(releaseQuota(20, 20)).toBe(0);
    expect(releaseQuota(10, 12)).toBe(0);
  });
});

describe('funil da campanha', () => {
  const counts: FunnelCounts = {
    selected: 200,
    eligible: 150,
    released: 100,
    contacted: 80,
    delivered: 60,
    replied: 20,
    interested: 8,
    opportunity: 4,
    converted: 1,
    optedOut: 2,
  };

  it('cada taxa sobre a sua base; pedidos de saída sobre os contatados', () => {
    const rows = Object.fromEntries(buildFunnel(counts).map((r) => [r.step, r]));
    expect(rows.selected).toMatchObject({ count: 200, base: null, rate: null });
    expect(rows.eligible).toMatchObject({ base: 'selected', rate: 0.75 });
    expect(rows.contacted).toMatchObject({ base: 'released', rate: 0.8 });
    expect(rows.replied).toMatchObject({ base: 'contacted', rate: 0.25 });
    expect(rows.interested).toMatchObject({ base: 'replied', rate: 0.4 });
    expect(rows.opportunity).toMatchObject({ base: 'contacted', rate: 0.05 });
    expect(rows.converted).toMatchObject({ base: 'opportunity', rate: 0.25 });
    expect(rows.optedOut).toMatchObject({ label: 'Pediram para sair', rate: 0.025 });
  });

  it('base zerada não tem taxa', () => {
    const empty = buildFunnel({ ...counts, contacted: 0, replied: 0 });
    expect(empty.find((r) => r.step === 'replied')?.rate).toBeNull();
    expect(empty.find((r) => r.step === 'optedOut')?.rate).toBeNull();
  });
});

describe('comparação A/B', () => {
  it('teste de duas proporções: diferença grande tem p pequeno; sem variação não há teste', () => {
    const strong = twoProportionTest(30, 100, 10, 100);
    expect(strong!.z).toBeCloseTo(3.5355, 3);
    expect(strong!.pValue).toBeLessThan(0.001);
    const same = twoProportionTest(10, 100, 10, 100);
    expect(same).toMatchObject({ z: 0, pValue: 1 });
    expect(twoProportionTest(0, 50, 0, 50)).toBeNull();
    expect(twoProportionTest(1, 0, 1, 10)).toBeNull();
  });

  it(`abaixo de ${AB_MIN_SAMPLE} contatados não há veredito`, () => {
    const [b] = compareVariants([
      { id: 'va', label: 'A', successes: 5, trials: 29 },
      { id: 'vb', label: 'B', successes: 20, trials: 40 },
    ]);
    expect(b).toMatchObject({
      label: 'B',
      baselineLabel: 'A',
      pValue: null,
      verdict: 'INSUFFICIENT_SAMPLE',
    });
    expect(b!.difference).toBeCloseTo(0.5 - 0.1724, 4);
  });

  it('diferença provável só abaixo do alfa dividido entre as comparações', () => {
    // p ≈ 0,0497: passa com uma comparação (alfa 0,05)…
    const two = compareVariants([
      { id: 'vb', label: 'B', successes: 39, trials: 100 },
      { id: 'va', label: 'A', successes: 26, trials: 100 },
    ]);
    expect(two).toHaveLength(1);
    expect(two[0]!.pValue).toBeLessThan(0.05);
    expect(two[0]).toMatchObject({ verdict: 'LIKELY_DIFFERENCE', difference: 0.13 });
    // …mas não com duas (alfa 0,025 para cada).
    const three = compareVariants([
      { id: 'va', label: 'A', successes: 26, trials: 100 },
      { id: 'vb', label: 'B', successes: 39, trials: 100 },
      { id: 'vc', label: 'C', successes: 27, trials: 100 },
    ]);
    expect(three.map((c) => [c.label, c.verdict])).toEqual([
      ['B', 'NO_DIFFERENCE'],
      ['C', 'NO_DIFFERENCE'],
    ]);
  });

  it('uma variante só não tem comparação', () => {
    expect(compareVariants([{ id: 'va', label: 'A', successes: 1, trials: 50 }])).toEqual([]);
  });
});

describe('estados da campanha', () => {
  it('segue o ciclo de vida e não pula etapas', () => {
    expect(canTransition('DRAFT', 'BUILDING')).toBe(true);
    expect(canTransition('BUILDING', 'READY')).toBe(true);
    expect(canTransition('BUILDING', 'DRAFT')).toBe(true);
    expect(canTransition('READY', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSED', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'COMPLETED')).toBe(true);
    expect(canTransition('COMPLETED', 'ARCHIVED')).toBe(true);

    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition('ACTIVE', 'ARCHIVED')).toBe(false);
    expect(canTransition('ACTIVE', 'DRAFT')).toBe(false);
    expect(canTransition('COMPLETED', 'ACTIVE')).toBe(false);
    expect(canTransition('ARCHIVED', 'DRAFT')).toBe(false);
  });

  it('estrutura só muda antes de ativar; ajustes, até concluir; leads presos enquanto pronta ou ativa', () => {
    expect(canEditStructure('READY')).toBe(true);
    expect(canEditStructure('ACTIVE')).toBe(false);
    expect(canEditSettings('PAUSED')).toBe(true);
    expect(canEditSettings('COMPLETED')).toBe(false);
    expect(CAMPAIGN_STATUSES.filter(holdsLeads)).toEqual(['READY', 'ACTIVE', 'PAUSED']);
  });
});
