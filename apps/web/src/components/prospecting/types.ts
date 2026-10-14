import type {
  getLeadRegistryData,
  getProspectingPotential,
  getProspectingSearch,
  getRegistryOverview,
  listProspectingSearches,
} from '@docline/core';

// Tipos das telas da Prospecção, tirados dos casos de uso (só tipos: nada do
// core vai para o navegador).
export type ProspectingSearchDetail = Awaited<ReturnType<typeof getProspectingSearch>>;
export type ProspectingResultView = ProspectingSearchDetail['results'][number];
export type ProspectingHistoryItem = Awaited<ReturnType<typeof listProspectingSearches>>[number];
export type ProspectingPotentialView = Awaited<ReturnType<typeof getProspectingPotential>>;
export type RegistryOverviewView = Awaited<ReturnType<typeof getRegistryOverview>>;
export type LeadRegistryView = Awaited<ReturnType<typeof getLeadRegistryData>>;

/** Parâmetros guardados na busca (para o histórico). */
export interface SearchParamsView {
  uf?: string;
  municipalityCodes?: number[];
  cnae?: string | null;
  headOfficeOnly?: boolean;
  onlyNew?: boolean;
  name?: string | null;
  limit?: number;
}
