import {
  getContactRules,
  getLead,
  getLeadCadence,
  getLeadContactability,
  getLeadScore,
  getPipeline,
  listCadences,
  listLeadMessages,
  listLeadOpportunities,
  listLeadStageHistory,
  listLeadTasks,
  listLeadTimeline,
  listLossReasons,
  listTags,
  listSalesOwners,
  listUsers,
  NotFoundError,
  roleHasPermission,
} from '@docline/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LeadDetail } from '@/components/leads/lead-detail';
import { getPageContext, loadLead } from '@/server/page-context';

export const metadata: Metadata = { title: 'Lead' };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, deps, meta } = await getPageContext();
  const actor = user.actor;
  // Fora do escopo (ou inexistente): 404, e a tentativa fica na auditoria (aceite M01).
  const lead = await loadLead(() => getLead(deps, actor, { leadId: id }, meta));
  if (!lead) notFound();

  const can = (permission: Parameters<typeof roleHasPermission>[1]) =>
    roleHasPermission(actor.role, permission);
  const [gate, timeline, tags, users, pipeline, lossReasons, stageHistory, score] =
    await Promise.all([
      getLeadContactability(deps, actor, { leadId: id }, meta),
      listLeadTimeline(deps, actor, { leadId: id }, meta),
      listTags(deps, actor, {}, meta),
      can('lead.assign')
        ? listUsers(deps, actor, { status: 'ACTIVE' }, meta)
        : Promise.resolve(null),
      getPipeline(deps, actor, {}, meta),
      listLossReasons(deps, actor, {}, meta),
      listLeadStageHistory(deps, actor, { leadId: id }, meta),
      // Sem modelo ativo (não deveria acontecer após o seed), a ficha abre sem o score.
      getLeadScore(deps, actor, { leadId: id }, meta).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      }),
    ]);
  // Operação SDR (Fase 5): tarefas, mensagens, cadência e transferência ao Comercial.
  const [tasks, messages, enrollments, cadences, opportunities, salesOwners, rules] =
    await Promise.all([
      listLeadTasks(deps, actor, { leadId: id }, meta),
      listLeadMessages(deps, actor, { leadId: id }, meta),
      getLeadCadence(deps, actor, { leadId: id }, meta),
      listCadences(deps, actor, {}, meta),
      listLeadOpportunities(deps, actor, { leadId: id }, meta),
      can('lead.update') ? listSalesOwners(deps, actor, {}, meta) : Promise.resolve([]),
      getContactRules(deps, actor, {}, meta),
    ]);
  const privileged = actor.role === 'ADMIN' || actor.role === 'MANAGER';

  return (
    <LeadDetail
      lead={lead}
      gate={gate.channels}
      timeline={timeline}
      sales={{
        stages: pipeline.stages,
        lossReasons,
        stageHistory,
        score,
        privileged,
      }}
      operation={{
        tasks,
        messages,
        enrollments,
        cadences: cadences.map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault })),
        opportunities,
        salesOwners,
        lossReasons: lossReasons.map((r) => ({ id: r.id, name: r.name })),
        optOutKeywords: rules.optOutKeywords,
        userId: actor.id,
        privileged,
        canEdit: can('lead.update') && !lead.readOnlyReason,
      }}
      options={{
        tags,
        ...(users ? { owners: users.map((u) => ({ id: u.id, name: u.name })) } : {}),
      }}
      permissions={{
        userId: actor.id,
        isAdmin: actor.role === 'ADMIN',
        canEdit: can('lead.update') && !lead.readOnlyReason,
        canAssign: can('lead.assign'),
        canClaim: actor.role === 'SDR' && lead.ownerId === null && lead.status === 'ACTIVE',
        canOptOut: can('optout.register'),
        canSetPermission: can('permission.update'),
        canAnonymize: can('lead.anonymize'),
      }}
    />
  );
}
