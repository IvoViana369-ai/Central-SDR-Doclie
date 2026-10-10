// Módulo prospecting (docs/INTEGRATIONS.md §9.1; Fase 9): base aberta do CNPJ
// (carga mensal do recorte de contabilidade), buscas na Prospecção com
// comparação com a base e aprovação humana, potencial por cidade e
// enriquecimento de leads pelos dados abertos.
export * from './domain';
export { FakeCompanyRegistrySource, fakeCnpj } from './infra/fake-source';
export {
  runRegistryCheck,
  runRegistryIngestion,
  startRegistryIngestion,
  type IngestionStats,
} from './application/ingestion';
export * from './contracts/schemas';
export {
  approveProspect,
  approveProspects,
  getProspectingSearch,
  listProspectingSearches,
  rejectProspects,
  runProspectingPurge,
  searchProspects,
  type ProspectingReason,
} from './application/prospecting';
export { getProspectingPotential } from './application/potential';
export { enrichLeadFromRegistry, getLeadRegistryData } from './application/enrichment';
export { REGISTRY_SOURCE_KEY, type RegistryView } from './infra/registry-row';
