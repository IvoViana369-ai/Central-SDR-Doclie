// Módulo tasks (docs/ARCHITECTURE.md §6): tarefas, atividades (ligação, reunião,
// visita) e a Minha Fila SDR (Fase 5).
export * from './domain';
export * from './contracts/schemas';
export {
  closeReplyTasks,
  closeTask,
  createTaskRecord,
  requireOpenTask,
  taskSelect,
} from './infra/tasks';
export { registerOutboundContact } from './infra/contact';
export {
  cancelTask,
  completeTask,
  createTask,
  listLeadTasks,
  rescheduleTask,
} from './application/tasks';
export { logActivity } from './application/activities';
