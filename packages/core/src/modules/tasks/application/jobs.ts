import type { CoreDeps } from '../../../shared/use-case';
import { notify } from '../../notifications';
import { loadContactRules } from '../../settings';

const DAY_MS = 86_400_000;

/**
 * Job `tasks.overdue-scan` (de hora em hora; F5-11): avisa cada pessoa das
 * tarefas que atrasaram (uma vez por tarefa) e os gestores das transferências
 * ao Comercial sem aceite no prazo.
 */
export async function runOverdueScan(deps: CoreDeps) {
  const now = deps.clock.now();
  return deps.db.$transaction(async (tx) => {
    const overdue = await tx.task.findMany({
      where: {
        status: 'OPEN',
        dueAt: { lt: now },
        overdueNotifiedAt: null,
        assigneeId: { not: null },
      },
      select: { id: true, assigneeId: true },
      take: 5_000,
    });
    const byUser = new Map<string, string[]>();
    for (const t of overdue) {
      byUser.set(t.assigneeId!, [...(byUser.get(t.assigneeId!) ?? []), t.id]);
    }
    for (const [userId, ids] of byUser) {
      await notify(tx, {
        userId,
        type: 'task.overdue',
        title: ids.length === 1 ? '1 tarefa atrasou' : `${ids.length} tarefas atrasaram`,
        body: 'Veja em Minha Fila, seção "Follow-ups atrasados".',
        link: '/fila',
      });
    }
    if (overdue.length > 0) {
      await tx.task.updateMany({
        where: { id: { in: overdue.map((t) => t.id) } },
        data: { overdueNotifiedAt: now },
      });
    }

    const late = await tx.opportunity.findMany({
      where: { status: 'OPEN', acceptedAt: null, acceptDueAt: { lt: now }, slaAlertedAt: null },
      select: { id: true, leadId: true, lead: { select: { displayName: true } } },
      take: 500,
    });
    if (late.length > 0) {
      const managers = await tx.user.findMany({
        where: { status: 'ACTIVE', role: { in: ['MANAGER', 'ADMIN'] } },
        select: { id: true },
      });
      for (const o of late) {
        for (const m of managers) {
          await notify(tx, {
            userId: m.id,
            type: 'handoff.sla',
            title: `Transferência sem aceite: ${o.lead.displayName}`,
            body: 'O prazo de aceite pelo Comercial passou.',
            leadId: o.leadId,
          });
        }
      }
      await tx.opportunity.updateMany({
        where: { id: { in: late.map((o) => o.id) } },
        data: { slaAlertedAt: now },
      });
    }
    const summary = {
      overdueTasks: overdue.length,
      notifiedUsers: byUser.size,
      lateHandoffs: late.length,
    };
    if (overdue.length + late.length > 0) deps.logger.info(summary, 'Atrasos avisados');
    return summary;
  });
}

/**
 * Job `leads.forgotten-scan` (diário; F5-11): avisa cada responsável de quantos
 * leads estão esquecidos (etapa aberta, sem tarefa e sem atividade há N dias).
 */
export async function runForgottenScan(deps: CoreDeps) {
  const now = deps.clock.now();
  return deps.db.$transaction(async (tx) => {
    const rules = await loadContactRules(tx);
    const groups = await tx.lead.groupBy({
      by: ['ownerId'],
      where: {
        ownerId: { not: null },
        status: 'ACTIVE',
        contactStatus: { notIn: ['OPTED_OUT', 'BLOCKED'] },
        stage: { category: 'OPEN' },
        nextActionAt: null,
        lastActivityAt: { lt: new Date(now.getTime() - rules.forgottenAfterDays * DAY_MS) },
      },
      _count: { _all: true },
    });
    for (const g of groups) {
      const n = g._count._all;
      await notify(tx, {
        userId: g.ownerId!,
        type: 'leads.forgotten',
        title: n === 1 ? '1 lead esquecido' : `${n} leads esquecidos`,
        body: `Sem atividade há mais de ${rules.forgottenAfterDays} dias e sem próxima tarefa.`,
        link: '/fila',
      });
    }
    return { owners: groups.length, leads: groups.reduce((sum, g) => sum + g._count._all, 0) };
  });
}
