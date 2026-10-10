import type { WhatsappParameterFormat, WhatsappTemplateCategory } from '../../../ports/whatsapp';

/**
 * Modelos (templates) do WhatsApp (docs/INTEGRATIONS.md §6.2, F7-04): o que o
 * app consegue enviar, a prévia com as variáveis e a validação dos valores.
 *
 * O app envia modelos com variáveis só no corpo. Cabeçalho com mídia ou com
 * variável, botões com variável (URL dinâmica, código) e modelos de
 * autenticação ficam visíveis, marcados como não suportados.
 */

export const TEMPLATE_CATEGORY_LABELS: Record<WhatsappTemplateCategory, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
};

export const TEMPLATE_STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Em análise',
  REJECTED: 'Rejeitado',
  PAUSED: 'Pausado pela Meta',
  DISABLED: 'Desativado pela Meta',
  IN_APPEAL: 'Em recurso',
  PENDING_DELETION: 'Sendo apagado',
  DELETED: 'Apagado',
  LIMIT_EXCEEDED: 'Limite excedido',
};

export function templateStatusLabel(status: string): string {
  return TEMPLATE_STATUS_LABELS[status] ?? status;
}

const VARIABLE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** Variáveis de um texto, na ordem em que aparecem, sem repetir. */
export function templateVariables(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(VARIABLE)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export interface TemplateAnalysis {
  bodyText: string;
  bodyParameters: string[];
  supported: boolean;
  unsupportedReason: string | null;
}

interface RawComponent {
  type?: unknown;
  format?: unknown;
  text?: unknown;
  buttons?: unknown;
}

const asText = (value: unknown) => (typeof value === 'string' ? value : '');

/** Lê os componentes da Meta e diz se o app consegue enviar o modelo. */
export function analyzeTemplate(
  category: WhatsappTemplateCategory,
  components: unknown[],
): TemplateAnalysis {
  const list = components.filter((c): c is RawComponent => typeof c === 'object' && c !== null);
  const byType = (type: string) => list.find((c) => asText(c.type).toUpperCase() === type);
  const body = byType('BODY');
  const bodyText = asText(body?.text);
  const result = (unsupportedReason: string | null): TemplateAnalysis => ({
    bodyText,
    bodyParameters: templateVariables(bodyText),
    supported: unsupportedReason === null,
    unsupportedReason,
  });

  if (category === 'AUTHENTICATION')
    return result('Modelo de autenticação não é usado na prospecção.');
  if (!bodyText) return result('Modelo sem corpo de texto.');
  if (list.some((c) => ['CAROUSEL', 'LIMITED_TIME_OFFER'].includes(asText(c.type).toUpperCase()))) {
    return result('Carrossel e oferta por tempo limitado não são enviados pelo app.');
  }
  const header = byType('HEADER');
  if (header) {
    const format = asText(header.format).toUpperCase() || 'TEXT';
    if (format !== 'TEXT')
      return result('Cabeçalho com mídia ou localização não é enviado pelo app.');
    if (templateVariables(asText(header.text)).length > 0) {
      return result('Cabeçalho com variável não é enviado pelo app.');
    }
  }
  const buttons = byType('BUTTONS');
  if (buttons && Array.isArray(buttons.buttons)) {
    for (const raw of buttons.buttons as RawComponent[]) {
      const type = asText(raw?.type).toUpperCase();
      const dynamic = templateVariables(JSON.stringify(raw ?? {})).length > 0;
      if (dynamic || !['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(type)) {
        return result('Botão com variável ou de tipo especial não é enviado pelo app.');
      }
    }
  }
  return result(null);
}

/** Texto do corpo com os valores no lugar das variáveis (prévia e registro do envio). */
export function renderTemplate(bodyText: string, values: Record<string, string>): string {
  return bodyText.replace(VARIABLE, (whole, name: string) => values[name] ?? whole);
}

export const TEMPLATE_PARAM_MAX_LENGTH = 200;

export interface TemplateParamIssue {
  parameter: string;
  message: string;
}

/**
 * Valores das variáveis: todos preenchidos, curtos e numa linha só (a Meta
 * recusa quebra de linha, tabulação e mais de quatro espaços seguidos).
 */
export function validateTemplateParams(
  parameters: string[],
  values: Record<string, string>,
): TemplateParamIssue[] {
  const issues: TemplateParamIssue[] = [];
  for (const parameter of parameters) {
    const value = (values[parameter] ?? '').trim();
    if (!value) {
      issues.push({ parameter, message: 'Preencha esta variável.' });
    } else if (value.length > TEMPLATE_PARAM_MAX_LENGTH) {
      issues.push({ parameter, message: `Use até ${TEMPLATE_PARAM_MAX_LENGTH} caracteres.` });
    } else if (/[\n\r\t]| {5,}/.test(value)) {
      issues.push({ parameter, message: 'Sem quebra de linha, tabulação ou espaços seguidos.' });
    }
  }
  for (const extra of Object.keys(values)) {
    if (!parameters.includes(extra)) {
      issues.push({ parameter: extra, message: 'Variável que o modelo não tem.' });
    }
  }
  return issues;
}

/** Valores já limpos, na ordem do modelo, para o envio. */
export function orderedTemplateParams(
  parameters: string[],
  values: Record<string, string>,
): { name: string; value: string }[] {
  return parameters.map((name) => ({ name, value: (values[name] ?? '').trim() }));
}

export function isParameterFormat(value: string): value is WhatsappParameterFormat {
  return value === 'POSITIONAL' || value === 'NAMED';
}
