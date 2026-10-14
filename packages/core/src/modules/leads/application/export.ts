import type { Prisma } from '@docline/db';
import { toCsv, type CsvValue } from '../../../shared/csv';
import { BusinessRuleError, RateLimitError } from '../../../shared/errors';
import { defineUseCase, type UseCaseContext } from '../../../shared/use-case';
import {
  CONTACT_STATUS_LABELS,
  findActiveSuppressions,
  identifierKey,
  isWhatsappCandidate,
  type SuppressionIdentifier,
} from '../../compliance';
import { formatCnpj, formatPhone } from '../../normalization';
import { exportLeadsInput } from '../contracts/filters';
import { formatLeadCode, LEAD_STATUS_LABELS, LEAD_TYPE_LABELS } from '../domain/lead';
import { maskSearchText } from '../infra/filters';
import { selectionWhere } from './search';

/** Leads por arquivo (acima disso, refine o filtro). */
export const EXPORT_LIMIT = 20_000;
/** Exportações por usuário em 24 horas (docs/SECURITY.md §12). */
export const EXPORTS_PER_DAY = 5;

const BATCH = 1_000;

const BASE_COLUMNS = [
  'Código',
  'Nome',
  'Razão social',
  'CNPJ',
  'Tipo',
  'Segmento',
  'Cidade',
  'UF',
  'Origem',
  'Situação',
  'Situação de contato',
  'Responsável',
  'Tags',
  'Site',
  'Criado em',
  'Última atividade',
];
const CONTACT_COLUMNS = ['Telefone', 'WhatsApp', 'E-mail', 'Instagram'];

const exportSelect = {
  id: true,
  code: true,
  displayName: true,
  companyName: true,
  cnpj: true,
  cnpjHash: true,
  leadType: true,
  cityRaw: true,
  stateUf: true,
  status: true,
  contactStatus: true,
  websiteUrl: true,
  createdAt: true,
  lastActivityAt: true,
  segment: { select: { name: true } },
  originSource: { select: { name: true } },
  owner: { select: { name: true } },
  tags: { select: { tag: { select: { name: true } } } },
} satisfies Prisma.LeadSelect;

type ExportLead = Prisma.LeadGetPayload<{ select: typeof exportSelect }>;

const formatDate = (date: Date) =>
  date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * Até 5 exportações por usuário em 24 h. O lock serializa pedidos simultâneos
 * do mesmo usuário. A janela usa a hora do banco, a mesma de `occurred_at`.
 */
async function enforceDailyLimit(ctx: UseCaseContext) {
  if (ctx.actor.kind !== 'user') return;
  await ctx.tx
    .$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`docline.export:${ctx.actor.id}`}))`;
  const [row] = await ctx.tx.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM audit_logs
    WHERE actor_id = ${ctx.actor.id}::uuid
      AND action = 'lead.export'
      AND occurred_at >= now() - interval '24 hours'`;
  if ((row?.count ?? 0) >= EXPORTS_PER_DAY) {
    throw new RateLimitError(
      `Limite de ${EXPORTS_PER_DAY} exportações em 24 horas atingido. Tente novamente mais tarde.`,
    );
  }
}

/**
 * Contatos que podem ir para o arquivo: ativos e fora da Lista Não Contatar
 * (em qualquer canal). Lead ou CNPJ na lista: nenhum contato sai.
 */
async function loadExportableContacts(ctx: UseCaseContext, leads: ExportLead[]) {
  const points = await ctx.tx.contactPoint.findMany({
    where: { leadId: { in: leads.map((l) => l.id) }, status: 'ACTIVE' },
    select: {
      leadId: true,
      type: true,
      valueNormalized: true,
      valueHash: true,
      phoneKind: true,
      whatsappStatus: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  const identifiers: SuppressionIdentifier[] = [
    ...leads.map((l) => ({ type: 'LEAD' as const, valueHash: l.id })),
    ...leads.flatMap((l) => (l.cnpjHash ? [{ type: 'CNPJ' as const, valueHash: l.cnpjHash }] : [])),
    ...points.map((cp) => ({ type: cp.type, valueHash: cp.valueHash })),
  ];
  const suppressed = await findActiveSuppressions(ctx.tx, identifiers);
  const isSuppressed = (identifier: SuppressionIdentifier) =>
    suppressed.has(identifierKey(identifier));
  const blockedLeads = new Set(
    leads
      .filter(
        (l) =>
          isSuppressed({ type: 'LEAD', valueHash: l.id }) ||
          (l.cnpjHash !== null && isSuppressed({ type: 'CNPJ', valueHash: l.cnpjHash })),
      )
      .map((l) => l.id),
  );

  const byLead = new Map<string, typeof points>();
  let omitted = 0;
  for (const cp of points) {
    if (blockedLeads.has(cp.leadId) || isSuppressed(cp)) {
      omitted++;
      continue;
    }
    const list = byLead.get(cp.leadId);
    if (list) list.push(cp);
    else byLead.set(cp.leadId, [cp]);
  }
  return { byLead, omitted };
}

function contactCells(points: Awaited<ReturnType<typeof loadExportableContacts>>['byLead']) {
  return (leadId: string): CsvValue[] => {
    const list = points.get(leadId) ?? [];
    const phone = list.find((cp) => cp.type === 'PHONE');
    const whatsapp = list.find(isWhatsappCandidate);
    const email = list.find((cp) => cp.type === 'EMAIL');
    const instagram = list.find((cp) => cp.type === 'INSTAGRAM');
    return [
      phone ? formatPhone(phone.valueNormalized) : null,
      whatsapp ? formatPhone(whatsapp.valueNormalized) : null,
      email?.valueNormalized ?? null,
      instagram ? `@${instagram.valueNormalized}` : null,
    ];
  };
}

function baseCells(lead: ExportLead): CsvValue[] {
  return [
    formatLeadCode(lead.code),
    lead.displayName,
    lead.companyName,
    lead.cnpj ? formatCnpj(lead.cnpj) : null,
    LEAD_TYPE_LABELS[lead.leadType],
    lead.segment?.name,
    lead.cityRaw,
    lead.stateUf,
    lead.originSource.name,
    LEAD_STATUS_LABELS[lead.status],
    CONTACT_STATUS_LABELS[lead.contactStatus],
    lead.owner?.name,
    lead.tags.map((t) => t.tag.name).join(', '),
    lead.websiteUrl,
    formatDate(lead.createdAt),
    formatDate(lead.lastActivityAt),
  ];
}

/**
 * Exportação de leads em CSV (F2-14; docs/LGPD.md §14): só ADMIN/GESTOR,
 * auditada (quem, quando, filtro e quantidade), com limite diário, proteção
 * contra injeção de fórmulas e contatos só quando pedidos e fora da Lista Não
 * Contatar. Gerada na hora e devolvida na resposta: nenhum arquivo fica guardado.
 */
export const exportLeads = defineUseCase({
  name: 'leads.export',
  access: 'lead.export',
  input: exportLeadsInput,
  async run(ctx, input) {
    await enforceDailyLimit(ctx);
    const where = await selectionWhere(ctx, input);
    const total = await ctx.tx.lead.count({ where });
    if (total === 0) throw new BusinessRuleError('Nenhum lead na seleção para exportar.');
    if (total > EXPORT_LIMIT) {
      throw new BusinessRuleError(
        `A seleção tem ${total.toLocaleString('pt-BR')} leads; o limite por arquivo é ${EXPORT_LIMIT.toLocaleString('pt-BR')}. Refine o filtro.`,
      );
    }

    const rows: CsvValue[][] = [];
    let omittedContacts = 0;
    let cursor: string | undefined;
    for (;;) {
      const leads = await ctx.tx.lead.findMany({
        where,
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: exportSelect,
      });
      if (leads.length === 0) break;
      let contacts: ((leadId: string) => CsvValue[]) | null = null;
      if (input.includeContacts) {
        const loaded = await loadExportableContacts(ctx, leads);
        omittedContacts += loaded.omitted;
        contacts = contactCells(loaded.byLead);
      }
      for (const lead of leads) {
        rows.push(contacts ? [...baseCells(lead), ...contacts(lead.id)] : baseCells(lead));
      }
      if (leads.length < BATCH) break;
      cursor = leads.at(-1)!.id;
    }

    await ctx.audit({
      action: 'lead.export',
      entityType: 'lead_export',
      entityId: null,
      metadata: {
        count: rows.length,
        includeContacts: input.includeContacts,
        omittedContacts,
        filter: input.filter ?? null,
        q: maskSearchText(input.q),
      },
    });

    const day = ctx.now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return {
      fileName: `leads-${day}.csv`,
      count: rows.length,
      omittedContacts,
      content: toCsv(
        input.includeContacts ? [...BASE_COLUMNS, ...CONTACT_COLUMNS] : BASE_COLUMNS,
        rows,
      ),
    };
  },
});
