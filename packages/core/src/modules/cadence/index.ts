// Módulo cadence (docs/ARCHITECTURE.md §6): cadências configuráveis, inscrição,
// avanço por tarefa concluída, parada automática e "Sem resposta" (Fase 5).
// Grava as tarefas dos passos direto no banco: o módulo de tarefas chama a
// cadência (avançar), nunca o contrário.
export * from './domain';
export * from './contracts/schemas';
export { advanceEnrollment, cadenceStageKeys } from './infra/engine';
export {
  enrollInCadence,
  enrollLead,
  getLeadCadence,
  pauseCadence,
  resumeCadence,
  skipCadenceStep,
  stopCadence,
} from './application/enrollment';
export { runCadenceTick } from './application/tick';
export {
  createCadence,
  listCadences,
  setDefaultCadence,
  updateCadence,
} from './application/config';
