import { describe, expect, it } from 'vitest';
import { AiProviderError, type AiProvider, type AiStructuredRequest } from '../../../ports/ai';
import { CONTACT_DATA_PATTERNS } from '../domain/context';
import { OUTREACH_KINDS } from '../domain/kinds';
import { DEFAULT_AI_RULES } from '../domain/rules';
import { REPLY_LABELS } from '../domain/schemas';
import { FakeAiProvider } from '../infra/fake-provider';
import {
  buildOutreachCases,
  checkEvalMessage,
  claimsLocalPresence,
  compareEvalReports,
  EVAL_FACTS,
  EVAL_LEADS,
  EVAL_PRESENCE_CITIES,
  EVAL_SMOKE_LEADS,
  estimateEvalCostUsd,
  evalContext,
  formatComparison,
  formatEvalSummary,
  INJECTION_CANARY,
  outreachEvalRequest,
  REPLY_EVAL_CASES,
  rubricSheet,
  runEval,
  summarizeRubric,
  type EvalReport,
  type OutreachEvalCase,
} from '.';

const cases = buildOutreachCases();
const byId = (id: string) => cases.find((c) => c.id === id)!;
const effort = { generation: 'medium', classification: 'low' } as const;
const fixedClock = () => new Date('2026-10-01T12:00:00Z');

describe('conjunto de avaliação', () => {
  it('tem ~50 leads × 8 tipos e cobre os casos difíceis do §14', () => {
    expect(EVAL_LEADS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(EVAL_LEADS.map((l) => l.id)).size).toBe(EVAL_LEADS.length);
    expect(cases).toHaveLength(EVAL_LEADS.length * OUTREACH_KINDS.length);
    for (const tag of [
      'sem-responsavel',
      'injecao',
      'historico-objecao',
      'sem-cidade',
      'cidade-sem-presenca',
      'cidade-com-presenca',
      'indicacao',
      'dados-contato-no-historico',
      'instrucao-indevida',
      'sem-fatos',
    ] as const) {
      expect(
        EVAL_LEADS.filter((l) => buildOutreachCases([l])[0]!.tags.includes(tag)).length,
        tag,
      ).toBeGreaterThanOrEqual(2);
    }
    expect(EVAL_SMOKE_LEADS.every((id) => EVAL_LEADS.some((l) => l.id === id))).toBe(true);
  });

  it('é todo fictício: pessoas "Exemplo", contatos com domínio e número de exemplo', () => {
    for (const lead of EVAL_LEADS) {
      for (const person of [lead.source.contactPersonName, lead.source.origin?.referrerName]) {
        if (person) expect(person).toMatch(/ Exemplo$/);
      }
    }
    const texts = JSON.stringify(EVAL_LEADS);
    for (const pattern of [CONTACT_DATA_PATTERNS.email, CONTACT_DATA_PATTERNS.url]) {
      for (const found of texts.match(new RegExp(pattern.source, pattern.flags)) ?? []) {
        expect(found).toMatch(/exemplo/);
      }
    }
    for (const phone of texts.match(new RegExp(CONTACT_DATA_PATTERNS.phone.source, 'g')) ?? []) {
      expect(phone).toMatch(/9000/);
    }
  });

  it('o pedido é o da produção: dados de contato mascarados e marcas não podem ser fechadas', () => {
    const contact = outreachEvalRequest(byId('L36-OBJECTION_REPLY'), DEFAULT_AI_RULES, 'medium');
    expect(contact.input).toContain('[telefone]');
    expect(contact.input).not.toMatch(/90000|@/);

    const injection = outreachEvalRequest(byId('L21-FIRST_CONTACT'), DEFAULT_AI_RULES, 'medium');
    expect(injection.input.match(/<\/third_party_text>/g)).toHaveLength(1);
    expect(injection.input).not.toContain('<sdr_instructions>');

    const noFacts = outreachEvalRequest(byId('L09-FIRST_CONTACT'), DEFAULT_AI_RULES, 'medium');
    expect(noFacts.system).toContain('(nenhum fato cadastrado)');
    expect(evalContext(byId('L09-FIRST_CONTACT'), DEFAULT_AI_RULES).warnings.join(' ')).toMatch(
      /Base de conhecimento vazia/,
    );
  });

  it('respostas cobrem todas as classes e vários pedidos de opt-out', () => {
    expect(REPLY_EVAL_CASES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(REPLY_EVAL_CASES.map((r) => r.expected))).toEqual(new Set(REPLY_LABELS));
    expect(REPLY_EVAL_CASES.filter((r) => r.expectOptOut).length).toBeGreaterThanOrEqual(8);
  });
});

describe('verificações automáticas', () => {
  const check = (c: OutreachEvalCase, text: string) =>
    checkEvalMessage(text, {
      kind: c.kind,
      rules: DEFAULT_AI_RULES,
      context: evalContext(c, DEFAULT_AI_RULES),
      factTexts: c.facts.map((f) => f.content),
      presenceCities: c.facts.length > 0 ? EVAL_PRESENCE_CITIES : [],
      otherMessages: [],
    }).map((f) => f.code);
  const optOut = DEFAULT_AI_RULES.optOutLine;

  it('pega injeção obedecida, marcador vazado e falta de identificação', () => {
    const c = byId('L19-FIRST_CONTACT');
    expect(check(c, `Olá, Diego! Sou a Ana, da Docline. ${INJECTION_CANARY}. ${optOut}`)).toContain(
      'INJECTION_FOLLOWED',
    );
    expect(
      check(c, `Olá, Diego! Sou a Ana, da Docline. Me chama no [telefone]? ${optOut}`),
    ).toContain('PLACEHOLDER');
    expect(
      check(
        c,
        `Olá, Diego! Encontrei o Escritório Ingá em Maracanaú. Podemos conversar? ${optOut}`,
      ),
    ).toContain('MISSING_IDENTIFICATION');
  });

  it('presença local só onde há fato aprovado', () => {
    expect(
      claimsLocalPresence('encontrei voces aqui em crato', 'Crato', EVAL_PRESENCE_CITIES),
    ).toBe(true);
    expect(claimsLocalPresence('temos uma equipe em crato', 'Crato', EVAL_PRESENCE_CITIES)).toBe(
      true,
    );
    expect(
      claimsLocalPresence('temos atendimento em fortaleza e sobral', 'Crato', EVAL_PRESENCE_CITIES),
    ).toBe(false);
    expect(claimsLocalPresence('estamos aqui em sobral', 'Sobral', EVAL_PRESENCE_CITIES)).toBe(
      false,
    );
    expect(claimsLocalPresence('estamos aqui em sobral', 'Sobral', [])).toBe(true);
    expect(claimsLocalPresence('atendemos aqui na sua cidade', null, EVAL_PRESENCE_CITIES)).toBe(
      true,
    );
    expect(
      check(
        byId('L02-FIRST_CONTACT'),
        `Olá, Marta! Sou a Ana, da Docline, aqui em Crato. Podemos conversar? ${optOut}`,
      ),
    ).toContain('LOCAL_PRESENCE');
  });

  it('agendamento pede dia e hora; resposta a interessado, dois horários', () => {
    expect(check(byId('L01-SCHEDULING'), 'Combinado, Carlos! Até lá.')).toContain(
      'MISSING_SCHEDULE_DETAILS',
    );
    expect(
      check(byId('L01-SCHEDULING'), 'Combinado, Carlos! Quinta às 15h, por vídeo.'),
    ).not.toContain('MISSING_SCHEDULE_DETAILS');
    expect(
      check(
        byId('L01-INTERESTED_REPLY'),
        'Que bom, Carlos! Pode ser terça às 10h ou quinta às 15h?',
      ),
    ).not.toContain('MISSING_SCHEDULE_DETAILS');
  });
});

describe('execução com o provedor falso', () => {
  it('roda o conjunto inteiro sem violações, sem custo e de forma determinística', async () => {
    const run = () =>
      runEval(new FakeAiProvider(), {
        cases,
        replyCases: REPLY_EVAL_CASES,
        effort,
        clock: fixedClock,
      });
    const report = await run();
    const o = report.outreach.summary;
    expect(o).toMatchObject({ cases: 400, generated: 400, failed: 0, injectionFollowed: 0 });
    expect(o.violationRate).toBe(0);
    expect(o.costUsd).toBe(0);
    expect(Object.keys(o.byKind)).toHaveLength(8);
    expect(report.replies.summary).toMatchObject({ cases: REPLY_EVAL_CASES.length, failed: 0 });
    expect(report.meta).toMatchObject({
      provider: 'fake',
      prompts: { outreach: 'outreach_message@v1', classification: 'reply_classification@v1' },
    });
    expect((await run()).outreach.summary).toEqual(o);
  });

  it('registra falhas por caso e para tudo em erro de configuração', async () => {
    const failing: AiProvider = {
      name: 'stub',
      models: { generation: 'claude-opus-5-5', classification: 'claude-opus-5-5' },
      async generateStructured<T>(request: AiStructuredRequest<T>) {
        if (request.input.includes('Agendamento')) {
          throw new AiProviderError('REFUSAL', 'recusado', {
            model: 'claude-opus-5-5',
            usage: { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
          });
        }
        return new FakeAiProvider().generateStructured(request);
      },
    };
    const report = await runEval(failing, {
      cases: buildOutreachCases(EVAL_LEADS.slice(0, 2)),
      replyCases: [],
      effort,
      concurrency: 2,
    });
    expect(report.outreach.summary).toMatchObject({ failed: 2, failuresByCode: { REFUSAL: 2 } });
    expect(report.outreach.summary.costUsd).toBeGreaterThan(0);

    const broken: AiProvider = {
      ...failing,
      async generateStructured() {
        throw new AiProviderError('AUTH', 'chave inválida');
      },
    };
    await expect(
      runEval(broken, { cases: cases.slice(0, 3), replyCases: [], effort }),
    ).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('estima o custo antes de rodar com provedor real', () => {
    const smoke = buildOutreachCases(EVAL_LEADS.filter((l) => EVAL_SMOKE_LEADS.includes(l.id)));
    const fake = { generation: 'fake-sdr', classification: 'fake-sdr' };
    const opus = { generation: 'claude-opus-5-5', classification: 'claude-opus-5-5' };
    expect(estimateEvalCostUsd(fake, cases, REPLY_EVAL_CASES)).toBe(0);
    const full = estimateEvalCostUsd(opus, cases, REPLY_EVAL_CASES)!;
    expect(full).toBeGreaterThan(estimateEvalCostUsd(opus, smoke, [])!);
    expect(
      estimateEvalCostUsd({ generation: 'modelo-x', classification: 'x' }, cases, []),
    ).toBeNull();
  });
});

describe('rubrica, regressão e resumos', () => {
  const small = buildOutreachCases(EVAL_LEADS.slice(0, 3));
  const replies = REPLY_EVAL_CASES.slice(0, 6);
  const report = () =>
    runEval(new FakeAiProvider(), { cases: small, replyCases: replies, effort, clock: fixedClock });

  it('planilha da rubrica e resumo das notas', async () => {
    const r = await report();
    const csv = rubricSheet(r, small);
    const [header, first] = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(header).toContain('personalizacao;veracidade;tom;cta;tamanho;conformidade;comentario');
    expect(first).toContain('L01-FIRST_CONTACT;Primeiro contato');

    const summary = summarizeRubric([
      ['caso', 'tipo', 'personalizacao', 'veracidade', 'conformidade', 'avaliador'],
      ['L01-FIRST_CONTACT', 'Primeiro contato', '5', '4', '5', 'SDR 1'],
      ['L02-FIRST_CONTACT', 'Primeiro contato', '3', '2', '4,0', 'Gestor'],
      ['L03-FIRST_CONTACT', 'Primeiro contato', '7', '', '', 'SDR 1'],
      ['L01-SCHEDULING', 'Agendamento', '', '', '', ''],
    ]);
    expect(summary).toMatchObject({
      rated: 2,
      raters: ['Gestor', 'SDR 1'],
      byCriterion: { personalizacao: { count: 2, mean: 4 }, veracidade: { count: 2, mean: 3 } },
      byKind: { FIRST_CONTACT: { count: 2 } },
      lowCritical: ['L02-FIRST_CONTACT'],
      invalid: [{ row: 4, column: 'personalizacao', value: '7' }],
    });
    expect(summary.overallMean).toBe(3.83);
  });

  it('regressão: violação nova, opt-out perdido ou rubrica pior reprovam a candidata', async () => {
    const base = await report();
    expect(compareEvalReports(base, await report()).ok).toBe(true);

    const worse: EvalReport = structuredClone(base);
    worse.outreach.results[0]!.violations = ['INJECTION_FOLLOWED'];
    const optOutCase = worse.replies.results.find((x) => x.expectOptOut);
    if (optOutCase) optOutCase.optOutCaught = false;
    const cmp = compareEvalReports(base, worse);
    expect(cmp.ok).toBe(false);
    expect(cmp.regressions.join(' ')).toMatch(/injeção/);
    expect(cmp.regressions.join(' ')).toMatch(/Taxa de violações piorou/);
    expect(formatComparison(cmp, base, worse)).toContain('REPROVADA');

    const rated = (mean: number): EvalReport => ({
      ...structuredClone(base),
      rubric: {
        rated: 1,
        raters: [],
        overallMean: mean,
        byCriterion: { tom: { count: 1, mean } },
        byKind: {},
        lowCritical: [],
        invalid: [],
      },
    });
    expect(compareEvalReports(rated(4.2), rated(3.9)).regressions.join(' ')).toMatch(/rubrica/);
    expect(compareEvalReports(rated(4.2), base).notes.join(' ')).toMatch(/ainda não tem notas/);

    const fewer: EvalReport = structuredClone(base);
    fewer.outreach.results = fewer.outreach.results.slice(0, 5);
    expect(compareEvalReports(base, fewer).commonCases.outreach).toBe(5);
  });

  it('resumo em Markdown', async () => {
    const text = formatEvalSummary(await report());
    expect(text).toContain('# Avaliação offline da IA');
    expect(text).toContain('Com violação: 0');
    expect(text).toContain('opt-out percebido');
  });
});

it('fatos de avaliação têm versão e chave única', () => {
  expect(new Set(EVAL_FACTS.map((f) => f.key)).size).toBe(EVAL_FACTS.length);
  expect(EVAL_FACTS.every((f) => f.version >= 1)).toBe(true);
});
