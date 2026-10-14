import { describe, expect, it } from 'vitest';
import {
  type AssignableLead,
  type AssignableSdr,
  DEFAULT_AUTO_ASSIGN_SETTINGS,
  isAvailable,
  planAutoAssign,
  resolveAutoAssignSettings,
} from './auto-assign';

const today = '2026-10-13';
const FORTALEZA = 2304400;
const SOBRAL = 2312908;
const RECIFE = 2611606;

function sdr(userId: string, extra: Partial<AssignableSdr> = {}): AssignableSdr {
  return {
    userId,
    autoAssign: true,
    awayUntil: null,
    maxActiveLeads: null,
    activeLeads: 0,
    lastAssignedAt: null,
    territories: [],
    ...extra,
  };
}

function lead(leadId: string, extra: Partial<AssignableLead> = {}): AssignableLead {
  return { leadId, stateUf: 'CE', municipalityCode: FORTALEZA, priority: 0, ...extra };
}

const territory = { ...DEFAULT_AUTO_ASSIGN_SETTINGS, strategy: 'TERRITORY' as const };
const roundRobin = { ...DEFAULT_AUTO_ASSIGN_SETTINGS, strategy: 'ROUND_ROBIN' as const };
const owners = (plan: ReturnType<typeof planAutoAssign>) =>
  Object.fromEntries(plan.assignments.map((a) => [a.leadId, a.userId]));

describe('configuração da distribuição automática', () => {
  it('desligada por padrão; valores inválidos voltam ao padrão', () => {
    expect(resolveAutoAssignSettings(null)).toEqual(DEFAULT_AUTO_ASSIGN_SETTINGS);
    expect(DEFAULT_AUTO_ASSIGN_SETTINGS.enabled).toBe(false);
    expect(resolveAutoAssignSettings({ enabled: true, strategy: 'ROUND_ROBIN' })).toMatchObject({
      enabled: true,
      strategy: 'ROUND_ROBIN',
      includeExistingPool: false,
    });
    expect(resolveAutoAssignSettings({ strategy: 'SORTEIO' })).toEqual(
      DEFAULT_AUTO_ASSIGN_SETTINGS,
    );
  });
});

describe('disponibilidade', () => {
  it('fora quem não participa ou está ausente até hoje (inclusive)', () => {
    expect(isAvailable(sdr('a'), today)).toBe(true);
    expect(isAvailable(sdr('a', { autoAssign: false }), today)).toBe(false);
    expect(isAvailable(sdr('a', { awayUntil: '2026-10-13' }), today)).toBe(false);
    expect(isAvailable(sdr('a', { awayUntil: '2026-10-12' }), today)).toBe(true);
  });
});

describe('planejador por território', () => {
  const cityOwner = sdr('cidade', {
    territories: [{ stateUf: 'CE', municipalityCode: FORTALEZA }],
  });
  const stateOwner = sdr('estado', { territories: [{ stateUf: 'CE', municipalityCode: null }] });

  it('quem cobre a cidade vem antes de quem cobre a UF inteira', () => {
    const plan = planAutoAssign(
      [lead('l1'), lead('l2', { municipalityCode: SOBRAL })],
      [stateOwner, cityOwner],
      territory,
      today,
    );
    expect(owners(plan)).toEqual({ l1: 'cidade', l2: 'estado' });
    expect(plan.assignments.every((a) => a.strategy === 'TERRITORY')).toBe(true);
  });

  it('território de outra cidade não cobre a UF; sem cobertura o lead fica no pool', () => {
    const plan = planAutoAssign(
      [
        lead('l1', { municipalityCode: SOBRAL }),
        lead('l2', { stateUf: 'PE', municipalityCode: RECIFE }),
      ],
      [cityOwner],
      territory,
      today,
    );
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped).toEqual([
      { leadId: 'l1', reason: 'NO_TERRITORY' },
      { leadId: 'l2', reason: 'NO_TERRITORY' },
    ]);
  });

  it('com o rodízio geral ligado, quem ninguém cobre vai para qualquer disponível', () => {
    const plan = planAutoAssign(
      [lead('l1', { stateUf: 'PE', municipalityCode: RECIFE })],
      [cityOwner],
      { ...territory, fallbackToAll: true },
      today,
    );
    expect(plan.assignments).toEqual([{ leadId: 'l1', userId: 'cidade', strategy: 'ROUND_ROBIN' }]);
  });

  it('dono da cidade no limite: o lead passa para quem cobre a UF', () => {
    const full = { ...cityOwner, maxActiveLeads: 10, activeLeads: 10 };
    const plan = planAutoAssign([lead('l1')], [full, stateOwner], territory, today);
    expect(owners(plan)).toEqual({ l1: 'estado' });
  });

  it('todos no limite: fica no pool com o motivo', () => {
    const full = { ...cityOwner, activeLeads: DEFAULT_AUTO_ASSIGN_SETTINGS.defaultCapacity };
    expect(planAutoAssign([lead('l1')], [full], territory, today).skipped).toEqual([
      { leadId: 'l1', reason: 'NO_CAPACITY' },
    ]);
    expect(planAutoAssign([lead('l1')], [], territory, today).skipped).toEqual([
      { leadId: 'l1', reason: 'NO_SDR' },
    ]);
  });
});

describe('planejador por rodízio', () => {
  it('alterna entre os disponíveis começando por quem recebeu há mais tempo', () => {
    const plan = planAutoAssign(
      ['l1', 'l2', 'l3', 'l4'].map((id) => lead(id)),
      [
        sdr('a', { lastAssignedAt: new Date('2026-10-12T15:00:00Z') }),
        sdr('b', { lastAssignedAt: new Date('2026-10-10T15:00:00Z') }),
        sdr('c', { lastAssignedAt: null }),
      ],
      roundRobin,
      today,
    );
    expect(plan.assignments.map((a) => a.userId)).toEqual(['c', 'b', 'a', 'c']);
    expect(plan.assignments.every((a) => a.strategy === 'ROUND_ROBIN')).toBe(true);
  });

  it('respeita o limite de cada pessoa e ignora ausentes e quem não participa', () => {
    const plan = planAutoAssign(
      ['l1', 'l2', 'l3'].map((id) => lead(id)),
      [
        sdr('a', { maxActiveLeads: 1 }),
        sdr('b'),
        sdr('fora', { autoAssign: false }),
        sdr('ferias', { awayUntil: '2026-10-20' }),
      ],
      roundRobin,
      today,
    );
    expect(plan.assignments.map((a) => a.userId)).toEqual(['a', 'b', 'b']);
  });

  it('maior prioridade primeiro; mesma entrada, mesmo resultado', () => {
    const leads = [lead('l1', { priority: 10 }), lead('l2', { priority: 90 })];
    const sdrs = [sdr('a'), sdr('b')];
    const first = planAutoAssign(leads, sdrs, roundRobin, today);
    expect(first.assignments.map((a) => a.leadId)).toEqual(['l2', 'l1']);
    expect(planAutoAssign([...leads].reverse(), [...sdrs].reverse(), roundRobin, today)).toEqual(
      first,
    );
  });
});
