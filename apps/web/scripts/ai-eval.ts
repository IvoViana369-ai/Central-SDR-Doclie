/**
 * Avaliação offline da IA (docs/AI-SDR.md §14). O conjunto é todo fictício:
 * nenhum dado de lead real sai daqui.
 *
 *   pnpm ai:eval [--smoke] [--leads L01,L17] [--kinds FIRST_CONTACT,REACTIVATION]
 *                [--no-replies] [--concurrency 4] [--out pasta] [--yes]
 *   pnpm ai:eval score --report <report.json> --sheet <rubrica preenchida .csv/.xlsx>
 *   pnpm ai:eval compare --base <report.json> --candidate <report.json>
 *
 * Sem AI_PROVIDER=anthropic, usa o provedor falso (sem custo). Com o provedor
 * real, mostra a estimativa de custo e só roda com --yes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { getServerEnv } from '@docline/config';
import type { AiEffort, AiProvider } from '@docline/core';
import { FakeAiProvider, OUTREACH_KINDS } from '@docline/core';
import {
  buildOutreachCases,
  compareEvalReports,
  EVAL_LEADS,
  EVAL_REPORT_FORMAT,
  EVAL_SMOKE_LEADS,
  estimateEvalCostUsd,
  formatComparison,
  formatEvalSummary,
  REPLY_EVAL_CASES,
  rubricGuide,
  rubricSheet,
  runEval,
  summarizeRubric,
  type EvalReport,
} from '@docline/core/ai-eval';
import { createAiProvider, readSpreadsheet } from '@docline/integrations';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const rootEnv = join(root, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** Caminhos relativos à pasta de onde o comando foi chamado (pnpm muda o cwd). */
const userPath = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);

const [command = 'run', ...rest] = process.argv.slice(2);
const isCommand = ['run', 'score', 'compare'].includes(command);
const { values } = parseArgs({
  args: isCommand ? rest : process.argv.slice(2),
  options: {
    smoke: { type: 'boolean', default: false },
    leads: { type: 'string' },
    kinds: { type: 'string' },
    'no-replies': { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '4' },
    out: { type: 'string' },
    yes: { type: 'boolean', default: false },
    report: { type: 'string' },
    sheet: { type: 'string' },
    base: { type: 'string' },
    candidate: { type: 'string' },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function readReport(path: string | undefined, flag: string): EvalReport {
  if (!path) fail(`Informe ${flag} <arquivo report.json>.`);
  const report = JSON.parse(readFileSync(userPath(path), 'utf8')) as EvalReport;
  if (report.format !== EVAL_REPORT_FORMAT) fail(`${path} não é um relatório da avaliação.`);
  return report;
}

function provider(): {
  ai: AiProvider;
  effort: { generation: AiEffort; classification: AiEffort };
} {
  if (process.env.AI_PROVIDER !== 'anthropic') {
    return { ai: new FakeAiProvider(), effort: { generation: 'medium', classification: 'low' } };
  }
  const env = getServerEnv();
  return {
    ai: createAiProvider(env),
    effort: { generation: env.AI_EFFORT_GENERATION, classification: env.AI_EFFORT_CLASSIFICATION },
  };
}

async function run() {
  const wanted = values.leads?.split(',').map((s) => s.trim().toUpperCase());
  const leads = EVAL_LEADS.filter((l) =>
    wanted ? wanted.includes(l.id) : !values.smoke || EVAL_SMOKE_LEADS.includes(l.id),
  );
  const kinds = values.kinds?.split(',').map((s) => s.trim().toUpperCase());
  if (kinds?.some((k) => !(OUTREACH_KINDS as readonly string[]).includes(k))) {
    fail(`Tipos válidos: ${OUTREACH_KINDS.join(', ')}`);
  }
  const cases = buildOutreachCases(leads).filter((c) => !kinds || kinds.includes(c.kind));
  const replyCases = values['no-replies'] ? [] : REPLY_EVAL_CASES;
  if (cases.length + replyCases.length === 0) fail('Nenhum caso selecionado.');
  const selection =
    [
      wanted ? `leads ${wanted.join(',')}` : values.smoke ? 'rodada rápida' : null,
      kinds ? `tipos ${kinds.join(',')}` : null,
      values['no-replies'] ? 'sem respostas' : null,
    ]
      .filter(Boolean)
      .join(' · ') || null;

  const { ai, effort } = provider();
  const estimate = estimateEvalCostUsd(ai.models, cases, replyCases, { effort: effort.generation });
  console.log(
    `${cases.length} mensagens + ${replyCases.length} respostas · provedor ${ai.name} (${ai.models.generation})`,
  );
  console.log(
    `Custo estimado: ${estimate === null ? 'modelo sem preço cadastrado' : `≈ US$ ${estimate.toFixed(2)}`}`,
  );
  if (ai.name !== 'fake' && !values.yes) {
    console.log('Provedor real: confira o custo e rode de novo com --yes para continuar.');
    return;
  }

  const report = await runEval(ai, {
    cases,
    replyCases,
    effort,
    selection,
    concurrency: Math.max(1, Number(values.concurrency) || 4),
    onProgress: (done, total) => process.stdout.write(`\r${done}/${total}`),
  });
  process.stdout.write('\n');

  const stamp = report.meta.startedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const out = values.out ? userPath(values.out) : join(root, '.ai-eval', `${stamp}-${ai.name}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const summary = formatEvalSummary(report);
  writeFileSync(join(out, 'resumo.md'), summary);
  writeFileSync(join(out, 'rubrica.csv'), rubricSheet(report, cases));
  writeFileSync(join(out, 'rubrica.md'), rubricGuide());
  console.log(summary);
  console.log(`Arquivos em ${out}`);
}

function score() {
  const report = readReport(values.report, '--report');
  if (!values.sheet) fail('Informe --sheet <planilha preenchida>.');
  const path = userPath(values.sheet);
  const sheet = readSpreadsheet(
    { fileName: path, content: readFileSync(path) },
    { maxBytes: 20 * 1024 * 1024, maxRows: 10_000, timeoutMs: 30_000 },
  );
  const rubric = summarizeRubric(sheet.rows.map((r) => r.cells));
  if (rubric.invalid.length > 0) {
    console.warn(
      `Notas ignoradas (fora de 1 a 5): ${rubric.invalid.map((i) => `linha ${i.row} ${i.column}="${i.value}"`).join('; ')}`,
    );
  }
  const updated: EvalReport = { ...report, rubric };
  writeFileSync(userPath(values.report!), `${JSON.stringify(updated, null, 2)}\n`);
  console.log(formatEvalSummary(updated));
}

function compare() {
  const base = readReport(values.base, '--base');
  const candidate = readReport(values.candidate, '--candidate');
  const comparison = compareEvalReports(base, candidate);
  console.log(formatComparison(comparison, base, candidate));
  if (!comparison.ok) process.exitCode = 1;
}

try {
  if (command === 'score') score();
  else if (command === 'compare') compare();
  else await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
