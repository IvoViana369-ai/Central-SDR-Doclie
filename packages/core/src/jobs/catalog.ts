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
} as const satisfies Record<string, JobDefinition>;

export const ALL_JOBS: JobDefinition[] = Object.values(JOBS);

/** Chave em app_settings onde o worker grava o último sinal de vida. */
export const WORKER_HEARTBEAT_KEY = 'worker.heartbeat';
