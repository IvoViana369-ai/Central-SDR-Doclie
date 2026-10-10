// Módulo settings (docs/ARCHITECTURE.md §6): regras de contato editáveis pelo
// ADMIN (janela, limites, palavras de opt-out, SLAs) e calendário útil do lead.
// Não depende de outros módulos.
export * from './domain';
export * from './contracts/schemas';
export {
  leadTimeZone,
  loadContactRules,
  loadLeadCalendar,
  type LeadPlace,
} from './infra/contact-rules';
export { getContactRules, updateContactRules } from './application/contact-rules';
