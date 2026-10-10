/**
 * Catálogo de jobs assíncronos (docs/ARCHITECTURE.md §10). O core define nomes e
 * políticas; o worker registra os handlers; o adaptador da fila cria as filas.
 */
export interface JobDefinition {
  name: string;
  /** Agendamento cron (UTC), quando o job é periódico. */
  cron?: string;
  retryLimit: number;
  retryDelaySeconds: number;
  /** Tempo máximo de execução antes de ser considerado travado. */
  expireInSeconds: number;
}

export const JOBS = {
  /** Sinal de vida do worker, lido pelo /api/health. */
  heartbeat: {
    name: 'system.heartbeat',
    cron: '* * * * *',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 60,
  },
  /** Lê a planilha enviada e grava as linhas (docs/ARCHITECTURE.md §10). */
  importParse: {
    name: 'import.parse',
    retryLimit: 1,
    retryDelaySeconds: 10,
    expireInSeconds: 300,
  },
  /** Normaliza, valida e casa as linhas com a base e com a Lista Não Contatar. */
  importPreview: {
    name: 'import.preview',
    retryLimit: 1,
    retryDelaySeconds: 10,
    expireInSeconds: 1800,
  },
  /** Grava as linhas confirmadas (retoma de onde parou, se o worker cair). */
  importCommit: {
    name: 'import.commit',
    retryLimit: 3,
    retryDelaySeconds: 30,
    expireInSeconds: 3600,
  },
  /** Apaga as linhas temporárias vencidas e lotes abandonados (docs/LGPD.md §12). */
  importPurge: {
    name: 'import.purge',
    cron: '17 4 * * *',
    retryLimit: 1,
    retryDelaySeconds: 300,
    expireInSeconds: 900,
  },
  /** Procura duplicados de leads cadastrados ou alterados (dados: `{ leadIds, source }`). */
  dedupCheckLead: {
    name: 'dedup.check-lead',
    retryLimit: 3,
    retryDelaySeconds: 30,
    expireInSeconds: 300,
  },
  /** Varredura completa de duplicados, em blocos por UF (docs/MVP.md M06). */
  dedupScan: {
    name: 'dedup.scan',
    cron: '43 3 * * *',
    retryLimit: 1,
    retryDelaySeconds: 600,
    expireInSeconds: 3600,
  },
  /** Recalcula o score de leads (ações em massa; dados: `{ leadIds, trigger }`). */
  scoreRecomputeLeads: {
    name: 'score.recompute-lead',
    retryLimit: 3,
    retryDelaySeconds: 30,
    expireInSeconds: 600,
  },
  /**
   * Recalcula toda a base (ativação de modelo) ou uma cidade (lista de
   * prioridades); dados: `{ trigger, municipalityCode? }`.
   */
  scoreRecomputeAll: {
    name: 'score.recompute-all',
    retryLimit: 2,
    retryDelaySeconds: 120,
    expireInSeconds: 3600,
  },
  /**
   * Cadências (docs/SDR-FLOW.md §4): conclui as que passaram do prazo sem
   * resposta, retoma pausas vencidas e recria tarefas de passo perdidas.
   */
  cadenceTick: {
    name: 'cadence.tick',
    cron: '*/5 * * * *',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 600,
  },
  /** Avisa tarefas atrasadas e transferências sem aceite no prazo (F5-11). */
  tasksOverdueScan: {
    name: 'tasks.overdue-scan',
    cron: '7 * * * *',
    retryLimit: 1,
    retryDelaySeconds: 300,
    expireInSeconds: 600,
  },
  /** Avisa cada responsável dos seus leads esquecidos (diário, 07:20 em Fortaleza). */
  leadsForgottenScan: {
    name: 'leads.forgotten-scan',
    cron: '20 10 * * *',
    retryLimit: 1,
    retryDelaySeconds: 600,
    expireInSeconds: 900,
  },
  /**
   * Envia uma mensagem do WhatsApp pela API (dados: `{ messageId }`). Sem nova
   * tentativa automática: falha conhecida vira "Tentar de novo" para a pessoa,
   * e resultado incerto nunca é repetido sozinho (docs/INTEGRATIONS.md §6.2).
   */
  whatsappSend: {
    name: 'whatsapp.send',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 120,
  },
  /**
   * Processa um webhook do WhatsApp guardado na inbox (dados: `{ eventId }`):
   * status, respostas, modelos e qualidade. Itens são idempotentes, então a
   * nova tentativa reprocessa sem duplicar.
   */
  whatsappWebhook: {
    name: 'whatsapp.webhook',
    retryLimit: 3,
    retryDelaySeconds: 60,
    expireInSeconds: 300,
  },
  /** Sugestão automática de classificação de uma resposta recebida (F7-07; `{ messageId }`). */
  whatsappSuggestClassification: {
    name: 'whatsapp.suggest-classification',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 180,
  },
  /** Sincroniza os modelos da conta na Meta (diário, 03:41 em Fortaleza). */
  whatsappSyncTemplates: {
    name: 'whatsapp.sync-templates',
    cron: '41 6 * * *',
    retryLimit: 1,
    retryDelaySeconds: 600,
    expireInSeconds: 300,
  },
  /** Qualidade, limite e situação do número na Meta (de hora em hora). */
  whatsappHealthCheck: {
    name: 'whatsapp.health-check',
    cron: '23 * * * *',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 120,
  },
  /**
   * Envia uma mensagem do Instagram pela API (dados: `{ messageId }`): texto a
   * quem escreveu ou resposta privada a comentário. Sem nova tentativa
   * automática, como no WhatsApp (docs/INTEGRATIONS.md §7.2).
   */
  instagramSend: {
    name: 'instagram.send',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 120,
  },
  /** Processa um webhook do Instagram guardado na inbox (dados: `{ eventId }`). */
  instagramWebhook: {
    name: 'instagram.webhook',
    retryLimit: 3,
    retryDelaySeconds: 60,
    expireInSeconds: 300,
  },
  /** Sugestão automática de classificação de uma mensagem recebida no Instagram (`{ messageId }`). */
  instagramSuggestClassification: {
    name: 'instagram.suggest-classification',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 180,
  },
  /**
   * Métricas públicas dos @ dos leads (Business Discovery, F8-04): de hora em
   * hora, no máximo o limite da configuração por rodada.
   */
  instagramDiscovery: {
    name: 'instagram.discovery',
    cron: '17 * * * *',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 900,
  },
  /**
   * Base aberta do CNPJ (F9-01): todo dia confere se a Receita publicou um mês
   * novo e completo e, se sim, começa a carga (ou retoma a interrompida).
   */
  registryCheck: {
    name: 'registry.check',
    cron: '31 6 * * *',
    retryLimit: 1,
    retryDelaySeconds: 600,
    expireInSeconds: 300,
  },
  /**
   * Carga de um mês da base aberta do CNPJ (dados: `{ ingestionId }`): longa,
   * em streaming; nova tentativa retoma do arquivo onde parou.
   */
  registryIngest: {
    name: 'registry.ingest',
    retryLimit: 3,
    retryDelaySeconds: 900,
    expireInSeconds: 14_400,
  },
  /** Apaga os resultados das buscas da Prospecção com mais de 30 dias (docs/LGPD.md §12). */
  prospectingPurge: {
    name: 'prospecting.purge',
    cron: '27 4 * * *',
    retryLimit: 1,
    retryDelaySeconds: 300,
    expireInSeconds: 600,
  },
  /** Confere a conta e o token do Instagram (diário, 04:13 em Fortaleza). */
  instagramAccountCheck: {
    name: 'instagram.account-check',
    cron: '13 7 * * *',
    retryLimit: 1,
    retryDelaySeconds: 600,
    expireInSeconds: 120,
  },
  /**
   * Monta a campanha (dados: `{ campaignId }`): retrato do filtro,
   * elegibilidade com motivos, distribuição entre SDRs e variantes do A/B.
   */
  campaignBuild: {
    name: 'campaign.build',
    retryLimit: 1,
    retryDelaySeconds: 60,
    expireInSeconds: 1800,
  },
  /**
   * Campanhas (de hora em hora; dados opcionais `{ campaignId }` logo após
   * ativar): conclui as vencidas, libera o lote do dia de cada SDR para a
   * cadência e atualiza os marcos do funil. Nunca envia mensagem.
   */
  campaignTick: {
    name: 'campaign.tick',
    cron: '11 * * * *',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 1800,
  },
  /**
   * Indicadores (de hora em hora; às 03h de Fortaleza, os últimos 7 dias):
   * atualiza os fatos por lead e recalcula `daily_metrics` de hoje e ontem,
   * cobrindo os dias sem execução. Dados opcionais `{ from, to }` recalculam
   * um período (até 366 dias).
   */
  analyticsRollup: {
    name: 'analytics.rollup',
    cron: '23 * * * *',
    retryLimit: 1,
    retryDelaySeconds: 300,
    expireInSeconds: 1800,
  },
  /**
   * Insights da carteira (diário, 07h05 em Fortaleza): fatos em SQL para a
   * equipe e cada SDR ativo, redigidos pela IA e conferidos (texto padrão se
   * a IA falhar); apaga os de mais de 180 dias.
   */
  analyticsInsights: {
    name: 'analytics.insights',
    cron: '5 10 * * *',
    retryLimit: 1,
    retryDelaySeconds: 900,
    expireInSeconds: 1800,
  },
  /**
   * Distribuição automática do pool (de hora em hora, quando ligada, e logo
   * depois de ligar): território ou rodízio, respeitando ausência e limite de
   * leads ativos. Só atribui lead sem responsável.
   */
  leadsAutoAssign: {
    name: 'leads.auto-assign',
    cron: '41 * * * *',
    retryLimit: 0,
    retryDelaySeconds: 0,
    expireInSeconds: 900,
  },
  /** Apaga payloads de webhook e mensagens de números sem lead com mais de 90 dias. */
  webhooksPurge: {
    name: 'webhooks.purge',
    cron: '47 4 * * *',
    retryLimit: 1,
    retryDelaySeconds: 600,
    expireInSeconds: 600,
  },
} as const satisfies Record<string, JobDefinition>;

export const ALL_JOBS: JobDefinition[] = Object.values(JOBS);

/** Chave em app_settings onde o worker grava o último sinal de vida. */
export const WORKER_HEARTBEAT_KEY = 'worker.heartbeat';
