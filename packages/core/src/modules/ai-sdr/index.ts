// Módulo ai-sdr (docs/AI-SDR.md): copiloto do SDR. Gera rascunhos e sugere
// classificações; nada sai sem aprovação humana. O provedor fica atrás da
// porta AiProvider (ports/ai.ts). Depende de leads, conformidade (gate),
// mensagens (envio assistido) e avisos; nenhum deles depende deste módulo.
export * from './domain';
export * from './prompts';
export * from './contracts/schemas';
export { FAKE_MODEL, FakeAiProvider } from './infra/fake-provider';
export { AI_STATUS_LABELS, type GenerationView } from './application/view';
export { generateOutreach } from './application/generate';
export {
  approveGeneration,
  discardGeneration,
  editGeneration,
  getGeneration,
  listLeadGenerations,
  rateGeneration,
} from './application/review';
export { suggestReplyClassification } from './application/classify';
export {
  createApproach,
  getAiRules,
  listApproaches,
  listKnowledgeItems,
  updateAiRules,
  updateApproach,
  upsertKnowledgeItem,
} from './application/config';
export { getAiUsage } from './application/usage';
// Para outros módulos que chamam a IA (insights da carteira, Fase 11).
export { IN_PROGRESS, usageColumns } from './application/generate';
export { alertBudget, assertAiAllowance } from './infra/sources';
