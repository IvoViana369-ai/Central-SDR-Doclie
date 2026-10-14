import type { UseCaseContext } from '../../../shared/use-case';
import { PRE_CONTACT_STAGE_KEYS, recordOutboundContact } from '../../engagement';
import { moveLeadToStageKey } from '../../pipeline';
import { closeReplyTasks } from './tasks';

/**
 * Contato de saída feito (mensagem confirmada, registro manual ou ligação
 * atendida): datas de contato do lead, tarefas "Responder" concluídas e, se o
 * lead ainda não tinha sido contatado, a etapa "Primeiro contato" (que só é
 * alcançada assim, depois do gate; docs/SDR-FLOW.md §3.2, regra 2).
 */
export async function registerOutboundContact(
  ctx: UseCaseContext,
  leadId: string,
  at: Date,
): Promise<{ firstContact: boolean }> {
  const result = await recordOutboundContact(ctx.tx, leadId, at);
  await closeReplyTasks(ctx, leadId, 'Respondido.');
  await moveLeadToStageKey(ctx, leadId, 'FIRST_CONTACT', {
    source: null,
    onlyFrom: PRE_CONTACT_STAGE_KEYS,
  });
  return result;
}
