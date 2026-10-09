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
} as const satisfies Record<string, JobDefinition>;

export const ALL_JOBS: JobDefinition[] = Object.values(JOBS);

/** Chave em app_settings onde o worker grava o último sinal de vida. */
export const WORKER_HEARTBEAT_KEY = 'worker.heartbeat';
