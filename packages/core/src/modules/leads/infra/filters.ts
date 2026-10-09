import type { ContactStatus, LeadStatus, LeadType, Prisma, ScoreBand } from '@docline/db';
import type { Actor } from '../../../shared/actor';
import { ValidationError, type ValidationIssue } from '../../../shared/errors';
import { maskEmail } from '../../../shared/mask';
import {
  maskIdentifier,
  normalizeEmail,
  normalizeInstagram,
  normalizePhone,
  toSearchKey,
} from '../../normalization';
import type { FilterCondition, FilterField, FilterNode, FilterOp } from '../contracts/filters';
import { parseLeadCode } from '../domain/lead';

const MAX_DEPTH = 4;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const LEAD_STATUSES: LeadStatus[] = ['ACTIVE', 'ARCHIVED', 'MERGED', 'ANONYMIZED'];
const CONTACT_STATUSES: ContactStatus[] = [
  'CONTACTABLE',
  'RESTRICTED',
  'NO_LEGAL_BASIS',
  'OPTED_OUT',
  'BLOCKED',
];
const SCORE_BANDS: ScoreBand[] = ['COLD', 'WARM', 'HOT', 'PRIORITY'];
const LEAD_TYPES: LeadType[] = [
  'ACCOUNTING_FIRM',
  'ACCOUNTANT',
  'REFERRAL_PARTNER',
  'COMPANY',
  'OTHER',
];

const ALLOWED_OPS: Record<FilterField, FilterOp[]> = {
  state: ['eq', 'in', 'isNull'],
  city: ['eq', 'in', 'isNull'],
  segment: ['eq', 'in', 'isNull'],
  leadType: ['eq', 'in'],
  origin: ['eq', 'in'],
  owner: ['eq', 'in', 'isNull'],
  status: ['eq', 'in'],
  contactStatus: ['eq', 'in'],
  hasPhone: ['eq'],
  hasWhatsapp: ['eq'],
  hasEmail: ['eq'],
  hasInstagram: ['eq'],
  hasWebsite: ['eq'],
  hasCnpj: ['eq'],
  tags: ['hasAny', 'hasAll', 'hasNone'],
  name: ['contains'],
  createdAt: ['gte', 'lte', 'between'],
  lastActivityAt: ['gte', 'lte', 'between'],
  collectedAt: ['gte', 'lte', 'between'],
  stage: ['eq', 'in'],
  scoreBand: ['eq', 'in', 'isNull'],
  score: ['gte', 'lte', 'between'],
};

class FilterIssue extends Error {}

function asString(value: unknown, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 120) {
    throw new FilterIssue('Valor de texto inválido.');
  }
  if (pattern && !pattern.test(value)) throw new FilterIssue('Valor inválido.');
  return value;
}

function asList<T>(value: unknown, item: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) {
    throw new FilterIssue('Informe uma lista com 1 a 500 valores.');
  }
  return value.map(item);
}

function asEnum<T extends string>(allowed: readonly T[]) {
  return (value: unknown): T => {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      throw new FilterIssue(`Valor inválido (aceitos: ${allowed.join(', ')}).`);
    }
    return value as T;
  };
}

const asUf = (v: unknown) => asString(v, /^[A-Z]{2}$/);
const asKey = (v: unknown) => asString(v, /^[A-Za-z0-9_]{1,60}$/);
const asUuid = (v: unknown) =>
  asString(v, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

function asIbge(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1_000_000 ||
    value > 9_999_999
  ) {
    throw new FilterIssue('Código IBGE inválido.');
  }
  return value;
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new FilterIssue('Use verdadeiro ou falso.');
  return value;
}

function asDate(value: unknown): Date {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) throw new FilterIssue('Data inválida.');
  return date;
}

function dateRange(op: FilterOp, value: unknown): Prisma.DateTimeFilter {
  if (op === 'gte') return { gte: asDate(value) };
  if (op === 'lte') return { lte: asDate(value) };
  const [from, to] = Array.isArray(value) && value.length === 2 ? value : [];
  if (from === undefined) throw new FilterIssue('Informe o intervalo [início, fim].');
  return { gte: asDate(from), lte: asDate(to) };
}

function asScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new FilterIssue('Score de 0 a 100.');
  }
  return value;
}

function scoreRange(op: FilterOp, value: unknown): Prisma.IntNullableFilter {
  if (op === 'gte') return { gte: asScore(value) };
  if (op === 'lte') return { lte: asScore(value) };
  const [from, to] = Array.isArray(value) && value.length === 2 ? value : [];
  if (from === undefined) throw new FilterIssue('Informe o intervalo [mínimo, máximo].');
  return { gte: asScore(from), lte: asScore(to) };
}

/** eq / in / isNull para um campo escalar. */
function scalar<T>(
  op: FilterOp,
  value: unknown,
  parse: (v: unknown) => T,
  build: (filter: T | { in: T[] } | null) => Prisma.LeadWhereInput,
  notNull?: Prisma.LeadWhereInput,
): Prisma.LeadWhereInput {
  if (op === 'eq') return build(parse(value));
  if (op === 'in') return build({ in: asList(value, parse) });
  // isNull: true = sem valor; false = com valor.
  return asBoolean(value) ? build(null) : (notNull ?? { NOT: build(null) });
}

interface CompileState {
  actor: Actor;
  /** Algum filtro de status? Sem ele, a lista mostra só os ativos. */
  hasStatus: boolean;
}

function compileCondition(c: FilterCondition, state: CompileState): Prisma.LeadWhereInput {
  if (!ALLOWED_OPS[c.field].includes(c.op)) {
    throw new FilterIssue(`Operador "${c.op}" não vale para o campo "${c.field}".`);
  }
  switch (c.field) {
    case 'state':
      return scalar(c.op, c.value, asUf, (f) => ({ stateUf: f }));
    case 'city':
      return scalar(c.op, c.value, asIbge, (f) => ({ municipalityCode: f }));
    case 'segment':
      if (c.op === 'isNull')
        return asBoolean(c.value) ? { segmentId: null } : { NOT: { segmentId: null } };
      return { segment: { key: c.op === 'eq' ? asKey(c.value) : { in: asList(c.value, asKey) } } };
    case 'leadType':
      return scalar(c.op, c.value, asEnum(LEAD_TYPES), (f) => ({
        leadType: f as Prisma.EnumLeadTypeFilter,
      }));
    case 'origin':
      return {
        originSource: { key: c.op === 'eq' ? asKey(c.value) : { in: asList(c.value, asKey) } },
      };
    case 'owner': {
      // "me" = o próprio usuário; para processos internos, nenhum lead.
      const owner = (v: unknown) =>
        v === 'me' ? (state.actor.kind === 'user' ? state.actor.id : NIL_UUID) : asUuid(v);
      return scalar(c.op, c.value, owner, (f) => ({ ownerId: f }));
    }
    case 'status':
      state.hasStatus = true;
      return scalar(c.op, c.value, asEnum(LEAD_STATUSES), (f) => ({
        status: f as Prisma.EnumLeadStatusFilter,
      }));
    case 'contactStatus':
      return scalar(c.op, c.value, asEnum(CONTACT_STATUSES), (f) => ({
        contactStatus: f as Prisma.EnumContactStatusFilter,
      }));
    case 'hasPhone':
    case 'hasWhatsapp':
    case 'hasEmail':
    case 'hasInstagram':
    case 'hasWebsite':
      return { [c.field]: asBoolean(c.value) };
    case 'hasCnpj':
      return asBoolean(c.value) ? { NOT: { cnpj: null } } : { cnpj: null };
    case 'tags': {
      const ids = asList(c.value, asUuid);
      if (c.op === 'hasAny') return { tags: { some: { tagId: { in: ids } } } };
      if (c.op === 'hasNone') return { tags: { none: { tagId: { in: ids } } } };
      return { AND: ids.map((tagId) => ({ tags: { some: { tagId } } })) };
    }
    case 'name':
      return { nameSearch: { contains: toSearchKey(asString(c.value)) } };
    case 'createdAt':
    case 'lastActivityAt':
    case 'collectedAt':
      return { [c.field]: dateRange(c.op, c.value) };
    case 'stage':
      return { stage: { key: c.op === 'eq' ? asKey(c.value) : { in: asList(c.value, asKey) } } };
    case 'scoreBand':
      return scalar(c.op, c.value, asEnum(SCORE_BANDS), (f) => ({
        scoreBand: f as Prisma.EnumScoreBandNullableFilter,
      }));
    case 'score':
      return { score: scoreRange(c.op, c.value) };
  }
}

function compileNode(
  node: FilterNode,
  state: CompileState,
  path: string,
  depth: number,
  issues: ValidationIssue[],
): Prisma.LeadWhereInput {
  if (depth > MAX_DEPTH) {
    issues.push({ path, message: `Filtro com mais de ${MAX_DEPTH} níveis.` });
    return {};
  }
  if ('all' in node) {
    return {
      AND: node.all.map((n, i) => compileNode(n, state, `${path}.all.${i}`, depth + 1, issues)),
    };
  }
  if ('any' in node) {
    if (node.any.length === 0) return {};
    return {
      OR: node.any.map((n, i) => compileNode(n, state, `${path}.any.${i}`, depth + 1, issues)),
    };
  }
  try {
    return compileCondition(node, state);
  } catch (error) {
    if (error instanceof FilterIssue) {
      issues.push({ path, message: `${node.field}: ${error.message}` });
      return {};
    }
    throw error;
  }
}

/** Busca livre: nome, código (L-000123), CNPJ, telefone, e-mail ou Instagram. */
export function compileSearch(q: string): Prisma.LeadWhereInput | null {
  const text = q.trim();
  if (text.length === 0) return null;
  const or: Prisma.LeadWhereInput[] = [];
  const key = toSearchKey(text);
  if (key.length >= 2) or.push({ nameSearch: { contains: key } });

  const digits = text.replace(/\D/g, '');
  const code = parseLeadCode(text);
  if (code !== null && digits.length <= 7) or.push({ code });

  if (digits.length >= 8 && digits.length <= 14 && /^[\d\s().\-/+]+$/.test(text)) {
    or.push({ cnpj: { startsWith: digits } });
    const phone = normalizePhone(text);
    if (phone.ok) {
      or.push({
        contactPoints: {
          some: { type: 'PHONE', valueNormalized: phone.value.e164, status: { not: 'REMOVED' } },
        },
      });
    }
  }
  if (text.includes('@') && !text.startsWith('@')) {
    const email = normalizeEmail(text);
    if (email.ok) {
      or.push({
        contactPoints: {
          some: { type: 'EMAIL', valueNormalized: email.value.email, status: { not: 'REMOVED' } },
        },
      });
    }
  }
  if (text.startsWith('@') || text.includes('instagram.com')) {
    const instagram = normalizeInstagram(text);
    if (instagram.ok) {
      or.push({
        contactPoints: {
          some: {
            type: 'INSTAGRAM',
            valueNormalized: instagram.value.handle,
            status: { not: 'REMOVED' },
          },
        },
      });
    }
  }
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}

/**
 * Texto da busca livre como vai para a auditoria: telefone, e-mail, CNPJ e
 * Instagram mascarados (mesmas regras de detecção de `compileSearch`).
 */
export function maskSearchText(q: string | undefined): string | null {
  const text = q?.trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 8 && /^[\d\s().\-/+]+$/.test(text)) {
    const phone = normalizePhone(text);
    return phone.ok
      ? maskIdentifier('PHONE', phone.value.e164)
      : `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
  }
  if (text.includes('@') && !text.startsWith('@')) {
    const email = normalizeEmail(text);
    return email.ok ? maskEmail(email.value.email) : '***@***';
  }
  if (text.startsWith('@') || text.includes('instagram.com')) {
    const instagram = normalizeInstagram(text);
    return instagram.ok ? maskIdentifier('INSTAGRAM', instagram.value.handle) : '@***';
  }
  return text;
}

/**
 * Compila filtro + busca para `where` do Prisma. Sem filtro de status, só
 * leads ativos. O escopo do ator é aplicado por quem chama (AND com o escopo).
 */
export function compileLeadSelection(
  actor: Actor,
  selection: { filter?: FilterNode; q?: string },
): Prisma.LeadWhereInput {
  const state: CompileState = { actor, hasStatus: false };
  const issues: ValidationIssue[] = [];
  const parts: Prisma.LeadWhereInput[] = [];
  if (selection.filter) parts.push(compileNode(selection.filter, state, 'filter', 1, issues));
  if (issues.length > 0) throw new ValidationError(issues, 'Filtro inválido.');
  if (selection.q) {
    const search = compileSearch(selection.q);
    if (search) parts.push(search);
  }
  if (!state.hasStatus) parts.push({ status: 'ACTIVE' });
  return { AND: parts };
}
