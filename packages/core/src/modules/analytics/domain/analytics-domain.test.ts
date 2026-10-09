import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/errors';
import {
  isSmallSample,
  matchPreset,
  MAX_PERIOD_DAYS,
  parseIsoDay,
  presetRange,
  ratio,
  resolvePeriod,
} from '.';

// 13/10/2026, 01:30 em Fortaleza (UTC−3): ainda é dia 13 lá, já é 13 em UTC.
const now = new Date('2026-10-13T04:30:00Z');

describe('período dos indicadores', () => {
  it('padrão: últimos 30 dias até hoje, no fuso da operação', () => {
    const period = resolvePeriod({}, now);
    expect(period).toMatchObject({ from: '2026-09-14', to: '2026-10-13' });
    expect(period.days).toHaveLength(30);
    expect(period.start).toEqual(new Date('2026-09-14T03:00:00Z'));
    expect(period.end).toEqual(new Date('2026-10-14T03:00:00Z'));
  });

  it('"hoje" respeita o fuso: 01:00 UTC ainda é o dia anterior em Fortaleza', () => {
    expect(resolvePeriod({}, new Date('2026-10-13T01:00:00Z')).to).toBe('2026-10-12');
  });

  it('recusa data inexistente, ordem invertida e período longo demais', () => {
    expect(parseIsoDay('2026-02-30')).toBeNull();
    expect(parseIsoDay('13/10/2026')).toBeNull();
    expect(() => resolvePeriod({ from: '2026-02-30' }, now)).toThrow(ValidationError);
    const issue = (input: { from?: string; to?: string }) => {
      try {
        resolvePeriod(input, now);
      } catch (error) {
        return (error as ValidationError).issues[0]?.message;
      }
      return null;
    };
    expect(issue({ from: '2026-10-14', to: '2026-10-13' })).toMatch(/depois da final/);
    expect(issue({ from: '2025-10-01', to: '2026-10-13' })).toMatch(`${MAX_PERIOD_DAYS} dias`);
    expect(resolvePeriod({ from: '2026-10-13', to: '2026-10-13' }, now).days).toEqual([
      '2026-10-13',
    ]);
  });

  it('atalhos: mês passado atravessa o ano; o filtro ativo é reconhecido', () => {
    expect(presetRange('mes-anterior', new Date('2026-01-15T12:00:00Z'))).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('mes', now)).toEqual({ from: '2026-10-01', to: '2026-10-13' });
    expect(presetRange('7d', now)).toEqual({ from: '2026-10-07', to: '2026-10-13' });
    expect(matchPreset(presetRange('90d', now), now)).toBe('90d');
    expect(matchPreset({ from: '2026-10-02', to: '2026-10-05' }, now)).toBeNull();
  });
});

describe('taxas', () => {
  it('sem base não há taxa; amostra pequena abaixo de 20', () => {
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(0, 0)).toBeNull();
    expect(isSmallSample(0)).toBe(false);
    expect(isSmallSample(19)).toBe(true);
    expect(isSmallSample(20)).toBe(false);
  });
});
