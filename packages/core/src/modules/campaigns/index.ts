// Módulo campaigns (docs/ROADMAP.md, Fase 10): campanhas de prospecção com
// retrato do filtro, elegibilidade com motivos, distribuição entre SDRs,
// liberação diária para a cadência, funil e teste A/B de abordagens.
// Campanha não envia mensagem: cada contato passa pelo gate de sempre.
export * from './domain';
export * from './contracts/schemas';
export {
  campaignAction,
  createCampaign,
  getCampaign,
  getLeadCampaigns,
  listCampaignLeads,
  listCampaigns,
  removeCampaignLead,
  updateCampaign,
} from './application/campaigns';
export { runCampaignBuild } from './application/build';
export { runCampaignTick } from './application/release';
