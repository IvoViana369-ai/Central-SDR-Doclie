import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/errors';
import {
  allowedNumbers,
  checkInsightText,
  formatPercent,
  type InsightFact,
  INSIGHT_TYPES,
  insightsOutputSchema,
  isSmallSample,
  matchPreset,
  MAX_PERIOD_DAYS,
  monthLabel,
  numbersIn,
  parseIsoDay,
  presetRange,
  ratio,
  rateStat,
  resolveMonths,
  resolvePeriod,
  templateText,
  wilsonInterval,
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

describe('intervalo de confiança e comparação (F11-03)', () => {
  it('Wilson a 95%: valores de referência, sem sair de 0–100%', () => {
    expect(wilsonInterval(10, 20)).toEqual({ low: 0.2993, high: 0.7007 });
    expect(wilsonInterval(0, 10)).toEqual({ low: 0, high: 0.2775 });
    expect(wilsonInterval(10, 10)).toEqual({ low: 0.7225, high: 1 });
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it('o intervalo estreita com a base maior', () => {
    const small = wilsonInterval(5, 20)!;
    const large = wilsonInterval(500, 2000)!;
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it('acima ou abaixo só quando o intervalo inteiro fica de um lado da referência', () => {
    expect(rateStat(60, 100, 0.3).comparison).toBe('ABOVE');
    expect(rateStat(10, 100, 0.3).comparison).toBe('BELOW');
    expect(rateStat(35, 100, 0.3).comparison).toBe('SIMILAR');
  });

  it('amostra abaixo de 20: mostra a taxa, mas não compara', () => {
    const stat = rateStat(15, 19, 0.1);
    expect(stat).toMatchObject({ rate: 0.7895, smallSample: true, comparison: 'INSUFFICIENT' });
    expect(stat.interval).not.toBeNull();
    expect(rateStat(3, 10).comparison).toBeNull();
    expect(rateStat(0, 0, 0.3)).toMatchObject({ rate: null, interval: null, comparison: null });
  });
});

describe('meses da evolução mensal', () => {
  it('padrão: os últimos 12 meses, o atual incluído, no fuso da operação', () => {
    const range = resolveMonths({}, now);
    expect(range).toMatchObject({ from: '2025-11', to: '2026-10' });
    expect(range.months).toHaveLength(12);
    expect(range.start).toEqual(new Date('2025-11-01T03:00:00Z'));
    expect(range.end).toEqual(new Date('2026-11-01T03:00:00Z'));
    // 31/10 às 23h em Fortaleza já é novembro em UTC, mas ainda é outubro lá.
    expect(resolveMonths({}, new Date('2026-11-01T02:00:00Z')).to).toBe('2026-10');
  });

  it('atravessa a virada do ano e recusa mês inválido, invertido ou longo demais', () => {
    expect(resolveMonths({ from: '2025-12', to: '2026-02' }, now).months).toEqual([
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(() => resolveMonths({ from: '2026-13' }, now)).toThrow(ValidationError);
    expect(() => resolveMonths({ from: '2026-05', to: '2026-04' }, now)).toThrow(ValidationError);
    expect(() => resolveMonths({ from: '2023-01', to: '2026-01' }, now)).toThrow(ValidationError);
    expect(resolveMonths({ from: '2023-02', to: '2026-01' }, now).months).toHaveLength(36);
  });

  it('rótulo curto em português', () => {
    expect(monthLabel('2026-10')).toBe('out/2026');
    expect(monthLabel('2027-01')).toBe('jan/2027');
  });
});

describe('insights da carteira (F11-04)', () => {
  const facts: InsightFact[] = [
    { type: 'AWAITING_ACTION', count: 1 },
    { type: 'PENDING_ACCEPTANCE', count: 4 },
    { type: 'PRIORITY_TO_CONTACT', count: 1234 },
    { type: 'FORGOTTEN_IN_CITY', count: 12, city: 'Fortaleza', cityCode: 2304400, days: 7 },
    {
      type: 'BEST_APPROACH',
      approachId: 'a1',
      approach: 'Parceria',
      rate: 0.235,
      reference: 0.18,
      trials: 85,
      days: 30,
    },
    { type: 'TOP_POTENTIAL_CITY', city: 'Sobral', cityCode: 2312908, remaining: 41, offices: 58 },
  ];

  it('texto padrão de cada fato, com números no formato brasileiro', () => {
    expect(facts.map(templateText)).toEqual([
      '1 lead respondeu e espera uma ação.',
      '4 transferências ao Comercial passaram do prazo de aceite.',
      'Hoje há 1.234 escritórios prioritários ainda sem contato.',
      '12 leads de Fortaleza estão sem follow-up há mais de 7 dias.',
      'A abordagem "Parceria" teve 23,5% de resposta, acima da média de 18% (85 primeiros contatos em 30 dias).',
      'Sobral tem 41 escritórios ativos que ainda não são leads (de 58 na base aberta do CNPJ).',
    ]);
    expect(formatPercent(0.24)).toBe('24%');
  });

  it('o texto padrão sempre passa na própria validação', () => {
    for (const fact of facts)
      expect(checkInsightText(templateText(fact), fact)).toEqual({ ok: true });
  });

  it('nome com dígitos (abordagem, cidade) não conta como número citado', () => {
    const fact: InsightFact = {
      ...(facts[4] as Extract<InsightFact, { type: 'BEST_APPROACH' }>),
      approach: 'Abordagem 2',
    };
    expect(checkInsightText(templateText(fact), fact)).toEqual({ ok: true });
    expect(checkInsightText('A "Abordagem 2" teve 2% de resposta.', fact).ok).toBe(false);
  });

  it('lê os números do texto: milhar com ponto e decimal com vírgula', () => {
    expect(numbersIn('Há 1.234 leads, 23,5% e 7 dias')).toEqual([
      { value: 1234, percent: false },
      { value: 23.5, percent: true },
      { value: 7, percent: false },
    ]);
    expect(allowedNumbers(facts[4]!)).toEqual({ plain: [85, 30], percent: [23.5, 24, 18, 18] });
  });

  it('recusa texto da IA com número que não está no fato', () => {
    const fact = facts[3]!;
    expect(
      checkInsightText('Fortaleza tem 12 leads parados há mais de 7 dias: retome hoje.', fact),
    ).toEqual({ ok: true });
    expect(checkInsightText('Fortaleza tem 15 leads parados há mais de 7 dias.', fact)).toEqual({
      ok: false,
      reason: 'número fora dos fatos: 15',
    });
    // Arredondar a taxa é aceito (24% para 23,5%); inventar outra, não.
    expect(checkInsightText('"Parceria" responde 24% contra 18% da média.', facts[4]!)).toEqual({
      ok: true,
    });
    // 30 é o período (dias), não uma taxa: "30%" não passa.
    expect(checkInsightText('"Parceria" responde 30% contra 18%.', facts[4]!)).toEqual({
      ok: false,
      reason: 'número fora dos fatos: 30%',
    });
    expect(checkInsightText('"Parceria" teve 85 contatos em 23 dias.', facts[4]!).ok).toBe(false);
  });

  it('recusa telefone, e-mail, link e tamanho fora do limite', () => {
    const fact = facts[0]!;
    for (const text of [
      'Ligue para (85) 99999-0000 hoje.',
      'Escreva para contato@example.com sobre 1 lead.',
      'Veja https://example.com: 1 lead espera.',
      'Curto',
      `1 lead espera. ${'a'.repeat(240)}`,
    ]) {
      expect(checkInsightText(text, fact).ok, text).toBe(false);
    }
  });

  it('saída da IA: um texto por tipo conhecido', () => {
    expect(
      insightsOutputSchema.safeParse({ insights: [{ type: 'AWAITING_ACTION', text: 'ok' }] })
        .success,
    ).toBe(true);
    expect(
      insightsOutputSchema.safeParse({ insights: [{ type: 'OUTRO', text: 'ok' }] }).success,
    ).toBe(false);
    expect(INSIGHT_TYPES).toHaveLength(6);
  });
});
