// Módulo engagement: estado de contato do lead compartilhado pela cadência, pelas
// tarefas, pelas mensagens e pela conformidade (inscrição em andamento, tarefas
// abertas, datas de contato). Não depende de outros módulos (evita ciclos:
// opt-out, arquivamento e mudança de etapa encerram a cadência por aqui).
export * from './domain';
export {
  OUTREACH_TASK_TYPES,
  cancelOpenTasks,
  engagementActorOf,
  findOngoingEnrollment,
  pauseLeadEnrollment,
  recordInboundContact,
  recordOutboundContact,
  refreshNextAction,
  stopEnrollmentOnStageChange,
  stopLeadEnrollment,
  syncEngagementWithContactState,
  type EngagementActor,
} from './infra/engagement';
