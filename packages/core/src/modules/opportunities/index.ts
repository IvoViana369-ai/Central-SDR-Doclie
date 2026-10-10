// Módulo opportunities (docs/ARCHITECTURE.md §6): transferência ao Comercial com
// checklist de qualificação, aceite com prazo, ganho e perda (Fase 5).
export * from './domain';
export * from './contracts/schemas';
export {
  acceptOpportunity,
  handoffToSales,
  listLeadOpportunities,
  listOpportunities,
  listSalesOwners,
  markOpportunityLost,
  markOpportunityWon,
} from './application/opportunities';
