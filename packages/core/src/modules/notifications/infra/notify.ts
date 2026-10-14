import type { DbTransaction } from '@docline/db';

export interface NotificationInput {
  userId: string;
  /** Ex.: handoff.created, handoff.sla, task.overdue, leads.forgotten. */
  type: string;
  title: string;
  body?: string | null;
  leadId?: string | null;
  link?: string | null;
}

/** Aviso no app (sino do cabeçalho), na transação de quem chama. */
export async function notify(tx: DbTransaction, input: NotificationInput): Promise<void> {
  await tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      leadId: input.leadId ?? null,
      link: input.link ?? (input.leadId ? `/leads/${input.leadId}` : null),
    },
  });
}
