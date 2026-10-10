import { AI_KIND_LABELS, type OutreachKind } from '../domain/kinds';
import type { EvalComparison } from './compare';
import type { EvalReport } from './runner';

/** Resumos em Markdown (pt-BR) para ler no terminal ou anexar ao PR. */

const pct = (value: number | null) =>
  value === null ? '—' : `${(value * 100).toFixed(1).replace('.', ',')}%`;
const usd = (value: number | null) =>
  value === null ? 'sem preço cadastrado' : `US$ ${value.toFixed(4).replace('.', ',')}`;

function table(header: string[], rows: (string | number | null)[][]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map((c) => (c === null ? '—' : String(c))).join(' | ')} |`),
  ];
}

export function formatEvalSummary(report: EvalReport): string {
  const { meta } = report;
  const o = report.outreach.summary;
  const r = report.replies.summary;
  const lines = [
    '# Avaliação offline da IA',
    '',
    `- Provedor: **${meta.provider}** · geração \`${meta.models.generation}\` (esforço ${meta.effort.generation}) · classificação \`${meta.models.classification}\` (esforço ${meta.effort.classification})`,
    `- Prompts: \`${meta.prompts.outreach}\`, \`${meta.prompts.classification}\``,
    `- Seleção: ${meta.selection ?? 'conjunto completo'} · ${meta.startedAt} → ${meta.finishedAt}`,
    '',
    '## Mensagens',
    '',
    `- Casos: ${o.cases} · geradas: ${o.generated} · falhas: ${o.failed}${
      o.failed
        ? ` (${Object.entries(o.failuresByCode)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ')})`
        : ''
    }`,
    `- **Com violação: ${o.withViolation} (${pct(o.violationRate)})** · com aviso: ${o.withWarning}`,
    `- Injeção obedecida: ${o.injectionFollowed} · tamanho médio: ${o.avgChars ?? '—'} caracteres`,
    `- Custo estimado: ${usd(o.costUsd)} · latência p50/p95: ${o.latencyMs.p50 ?? '—'}/${o.latencyMs.p95 ?? '—'} ms${o.fallbackUsed ? ` · fallback: ${o.fallbackUsed}` : ''}`,
    '',
    ...table(
      ['Tipo', 'Casos', 'Geradas', 'Com violação', 'Tamanho médio'],
      Object.entries(o.byKind).map(([kind, g]) => [
        AI_KIND_LABELS[kind as OutreachKind] ?? kind,
        g.cases,
        g.generated,
        g.withViolation,
        g.avgChars,
      ]),
    ),
    '',
    ...table(
      ['Grupo', 'Casos', 'Com violação'],
      Object.entries(o.byTag)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, g]) => [tag, g.cases, g.withViolation]),
    ),
    '',
  ];
  const flags = Object.entries(o.flagsByCode).sort(([, a], [, b]) => b - a);
  if (flags.length > 0) {
    lines.push(...table(['Marcação', 'Casos'], flags), '');
  }
  const worst = report.outreach.results.filter((x) => x.violations.length > 0).slice(0, 10);
  if (worst.length > 0) {
    lines.push('### Exemplos com violação', '');
    for (const x of worst) {
      lines.push(`- \`${x.caseId}\` (${x.violations.join(', ')}): ${x.message}`);
    }
    lines.push('');
  }
  lines.push(
    '## Classificação de respostas',
    '',
    `- Casos: ${r.cases} · classificadas: ${r.classified} · falhas: ${r.failed}`,
    `- **Acerto: ${pct(r.accuracy)}** · **opt-out percebido: ${pct(r.optOutRecall)}**${r.missedOptOuts.length ? ` (não percebidos: ${r.missedOptOuts.join(', ')})` : ''}`,
    `- Regra determinística de opt-out: ${pct(r.ruleOptOutRecall)}${r.missedByRuleAndAi.length ? ` · **nem a regra nem a IA perceberam: ${r.missedByRuleAndAi.join(', ')}**` : ' · regra ou IA: todos percebidos'}`,
    `- Confiança baixa: ${r.lowConfidence} · custo estimado: ${usd(r.costUsd)}`,
  );
  if (r.mismatches.length > 0) {
    lines.push(
      '',
      ...table(
        ['Caso', 'Esperado', 'Sugerido'],
        r.mismatches.map((m) => [m.caseId, m.expected, m.got]),
      ),
    );
  }
  if (report.rubric) {
    const rb = report.rubric;
    lines.push(
      '',
      '## Rubrica humana',
      '',
      `- Linhas avaliadas: ${rb.rated} · avaliadores: ${rb.raters.join(', ') || '—'} · **média geral: ${rb.overallMean ?? '—'}**`,
      '',
      ...table(
        ['Critério', 'Notas', 'Média'],
        Object.entries(rb.byCriterion).map(([k, v]) => [k, v.count, v.mean]),
      ),
    );
    if (rb.lowCritical.length > 0) {
      lines.push('', `Notas 1–2 em veracidade ou conformidade: ${rb.lowCritical.join(', ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function formatComparison(
  comparison: EvalComparison,
  baseline: EvalReport,
  candidate: EvalReport,
): string {
  const describe = (r: EvalReport) =>
    `${r.meta.provider} · \`${r.meta.models.generation}\` · ${r.meta.prompts.outreach} · esforço ${r.meta.effort.generation}`;
  const fmt = (value: number | null, name: string) =>
    value === null
      ? '—'
      : name.startsWith('Taxa') ||
          name.includes('acerto') ||
          name.includes('percebido') ||
          name.includes('Falhas')
        ? pct(value)
        : String(value);
  const lines = [
    `# Regressão da IA: ${comparison.ok ? 'APROVADA' : 'REPROVADA'}`,
    '',
    `- Base: ${describe(baseline)}`,
    `- Candidata: ${describe(candidate)}`,
    `- Casos em comum: ${comparison.commonCases.outreach} mensagens, ${comparison.commonCases.replies} respostas`,
    '',
    ...table(
      ['Métrica', 'Base', 'Candidata'],
      comparison.metrics.map((m) => [m.name, fmt(m.baseline, m.name), fmt(m.candidate, m.name)]),
    ),
    '',
  ];
  if (comparison.regressions.length > 0) {
    lines.push('## Regressões', '', ...comparison.regressions.map((r) => `- ${r}`), '');
  }
  if (comparison.notes.length > 0) {
    lines.push('## Observações', '', ...comparison.notes.map((n) => `- ${n}`), '');
  }
  return `${lines.join('\n')}\n`;
}
