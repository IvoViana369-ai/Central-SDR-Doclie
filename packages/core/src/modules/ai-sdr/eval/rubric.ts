import { toCsv } from '../../../shared/csv';
import type { OutreachKind } from '../domain/kinds';
import { AI_KIND_LABELS } from '../domain/kinds';
import type { OutreachEvalCase } from './dataset';
import type { EvalReport } from './runner';

/**
 * Rubrica humana da avaliação (docs/AI-SDR.md §14): seis critérios de 1 a 5,
 * com âncoras para que SDR e gestor deem a mesma nota ao mesmo texto. As
 * notas calibram, mais tarde, um avaliador automático.
 */

export interface RubricCriterion {
  key: string;
  label: string;
  question: string;
  anchors: { 1: string; 3: string; 5: string };
}

export const RUBRIC_CRITERIA: RubricCriterion[] = [
  {
    key: 'personalizacao',
    label: 'Personalização',
    question: 'Usa elementos concretos e corretos deste lead?',
    anchors: {
      1: 'Genérica: serviria para qualquer escritório.',
      3: 'Um elemento concreto, pouco aproveitado.',
      5: 'Dois ou mais elementos do lead, usados com naturalidade.',
    },
  },
  {
    key: 'veracidade',
    label: 'Veracidade',
    question: 'Tudo o que afirma está nos dados do lead ou nos fatos aprovados?',
    anchors: {
      1: 'Inventa fato, número, relação ou presença local.',
      3: 'Exagero ou suposição que não foi registrada.',
      5: 'Nada inventado; o que supôs está em "suposições".',
    },
  },
  {
    key: 'tom',
    label: 'Tom',
    question: 'Soa como uma pessoa real, cordial e profissional?',
    anchors: {
      1: 'Robótico, agressivo, íntimo demais ou cheio de clichês.',
      3: 'Correto, mas rígido ou com frases feitas.',
      5: 'Natural, cordial e profissional.',
    },
  },
  {
    key: 'cta',
    label: 'Clareza do CTA',
    question: 'Termina com um pedido claro e fácil de responder?',
    anchors: {
      1: 'Sem pedido, ou vários pedidos ao mesmo tempo.',
      3: 'Pedido presente, mas vago ou difícil de responder.',
      5: 'Uma pergunta simples, que se responde em uma linha.',
    },
  },
  {
    key: 'tamanho',
    label: 'Tamanho',
    question: 'O tamanho combina com o canal e o tipo de mensagem?',
    anchors: {
      1: 'Longa demais para o canal, ou corta o essencial.',
      3: 'Um pouco longa ou curta demais.',
      5: 'Dentro do limite e sem sobras.',
    },
  },
  {
    key: 'conformidade',
    label: 'Conformidade',
    question: 'Identifica quem escreve, oferece opt-out quando exigido e evita pressão?',
    anchors: {
      1: 'Sem identificação, sem opt-out exigido ou com pressão indevida.',
      3: 'Identificação ou opt-out pouco claros.',
      5: 'Identifica a pessoa e a Docline, opt-out quando exigido, sem pressão.',
    },
  },
];

const INFO_COLUMNS = [
  'caso',
  'tipo',
  'marcas',
  'lead',
  'cidade',
  'responsavel',
  'origem',
  'ultima_mensagem_recebida',
  'mensagem',
  'caracteres',
  'violacoes',
  'avisos',
] as const;
const RATER_COLUMNS = ['comentario', 'avaliador'] as const;

/**
 * Planilha para a avaliação humana (CSV para o Excel): uma linha por
 * mensagem gerada, com as colunas da rubrica em branco. Uma linha só conta
 * no resumo quando tem ao menos uma nota.
 */
export function rubricSheet(report: EvalReport, cases: readonly OutreachEvalCase[]): string {
  const header = [...INFO_COLUMNS, ...RUBRIC_CRITERIA.map((c) => c.key), ...RATER_COLUMNS];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const rows = report.outreach.results
    .filter((r) => r.status === 'OK')
    .map((r) => {
      const source = byId.get(r.caseId)?.source;
      const origin = source?.origin;
      return [
        r.caseId,
        AI_KIND_LABELS[r.kind],
        r.tags.join(', '),
        source?.displayName ?? r.leadId,
        [source?.city, source?.uf].filter(Boolean).join('/'),
        source?.contactPersonName ?? '',
        origin ? [origin.sourceLabel, origin.referrerName].filter(Boolean).join(': ') : '',
        source?.interactions.find((i) => i.direction === 'INBOUND')?.body ?? '',
        r.message,
        r.chars,
        r.violations.join(', '),
        r.warnings.join(', '),
        ...RUBRIC_CRITERIA.map(() => ''),
        '',
        '',
      ];
    });
  return toCsv(header, rows);
}

/** Legenda da rubrica (vai junto da planilha, em Markdown). */
export function rubricGuide(): string {
  const lines = [
    '# Rubrica da avaliação da IA',
    '',
    'Dê uma nota de 1 a 5 em cada critério (2 e 4 ficam entre as âncoras). Deixe em branco o que não avaliou.',
    'Use a coluna `comentario` para explicar notas 1 e 2.',
    '',
  ];
  for (const c of RUBRIC_CRITERIA) {
    lines.push(`## ${c.label} (\`${c.key}\`)`, '', c.question, '');
    lines.push(
      `- **1:** ${c.anchors[1]}`,
      `- **3:** ${c.anchors[3]}`,
      `- **5:** ${c.anchors[5]}`,
      '',
    );
  }
  return lines.join('\n');
}

export interface RubricSummary {
  /** Linhas com ao menos uma nota. */
  rated: number;
  raters: string[];
  overallMean: number | null;
  byCriterion: Record<string, { count: number; mean: number | null }>;
  byKind: Record<string, { count: number; mean: number | null }>;
  /** Linhas com nota 1 ou 2 em veracidade ou conformidade (para leitura). */
  lowCritical: string[];
  invalid: { row: number; column: string; value: string }[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const KIND_BY_LABEL = new Map(
  Object.entries(AI_KIND_LABELS).map(([kind, label]) => [label, kind as OutreachKind]),
);

/**
 * Resume a planilha preenchida. `rows[0]` é o cabeçalho; as colunas são
 * achadas pelo nome, então a ordem pode mudar no Excel.
 */
export function summarizeRubric(rows: string[][]): RubricSummary {
  const [header = [], ...body] = rows;
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const caseCol = col('caso');
  const kindCol = col('tipo');
  const raterCol = col('avaliador');
  const totals: Record<string, { sum: number; count: number }> = {};
  const kinds: Record<string, { sum: number; count: number }> = {};
  const raters = new Set<string>();
  const invalid: RubricSummary['invalid'] = [];
  const lowCritical: string[] = [];
  let rated = 0;
  let overall = { sum: 0, count: 0 };

  body.forEach((cells, index) => {
    const scores: Record<string, number> = {};
    for (const criterion of RUBRIC_CRITERIA) {
      const i = col(criterion.key);
      const raw = i >= 0 ? (cells[i] ?? '').trim() : '';
      if (!raw) continue;
      const value = Number(raw.replace(',', '.'));
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        invalid.push({ row: index + 2, column: criterion.key, value: raw });
        continue;
      }
      scores[criterion.key] = value;
    }
    const values = Object.values(scores);
    if (values.length === 0) return;
    rated += 1;
    const rater = raterCol >= 0 ? (cells[raterCol] ?? '').trim() : '';
    if (rater) raters.add(rater);
    for (const [key, value] of Object.entries(scores)) {
      const t = (totals[key] ??= { sum: 0, count: 0 });
      t.sum += value;
      t.count += 1;
      overall = { sum: overall.sum + value, count: overall.count + 1 };
    }
    const kindLabel = kindCol >= 0 ? (cells[kindCol] ?? '').trim() : '';
    const kind = KIND_BY_LABEL.get(kindLabel) ?? (kindLabel || 'sem tipo');
    const k = (kinds[kind] ??= { sum: 0, count: 0 });
    k.sum += values.reduce((s, v) => s + v, 0) / values.length;
    k.count += 1;
    if ((scores.veracidade ?? 5) <= 2 || (scores.conformidade ?? 5) <= 2) {
      lowCritical.push(
        caseCol >= 0 ? (cells[caseCol] ?? `linha ${index + 2}`) : `linha ${index + 2}`,
      );
    }
  });

  const mean = (t?: { sum: number; count: number }) =>
    t && t.count > 0 ? round2(t.sum / t.count) : null;
  return {
    rated,
    raters: [...raters].sort(),
    overallMean: mean(overall),
    byCriterion: Object.fromEntries(
      RUBRIC_CRITERIA.map((c) => [
        c.key,
        { count: totals[c.key]?.count ?? 0, mean: mean(totals[c.key]) },
      ]),
    ),
    byKind: Object.fromEntries(
      Object.entries(kinds).map(([kind, t]) => [kind, { count: t.count, mean: mean(t) }]),
    ),
    lowCritical,
    invalid,
  };
}
