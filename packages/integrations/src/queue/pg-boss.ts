import type { EnqueueOptions, JobDefinition, JobQueue, Logger } from '@docline/core';
import { ALL_JOBS } from '@docline/core';
import { fromPrisma, PgBoss } from 'pg-boss';

export interface PgBossOptions {
  connectionString: string;
  schema: string;
  /**
   * 'producer' (web): só enfileira — sem supervisão nem agendamentos.
   * 'worker': processa jobs, mantém a fila e dispara agendamentos cron.
   */
  role: 'producer' | 'worker';
  logger: Logger;
  maxConnections?: number;
}

export async function startPgBoss(options: PgBossOptions): Promise<PgBoss> {
  const isWorker = options.role === 'worker';
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: options.schema,
    max: options.maxConnections ?? (isWorker ? 5 : 2),
    application_name: `docline-${options.role}`,
    supervise: isWorker,
    schedule: isWorker,
  });
  boss.on('error', (error) => options.logger.error({ err: error }, 'Erro na fila pg-boss'));
  await boss.start();
  await ensureQueues(boss, ALL_JOBS);
  return boss;
}

/** Cria as filas do catálogo (idempotente). */
export async function ensureQueues(boss: PgBoss, jobs: JobDefinition[]): Promise<void> {
  for (const job of jobs) {
    const queue = {
      retryLimit: job.retryLimit,
      retryDelay: job.retryDelaySeconds,
      retryBackoff: job.retryLimit > 0,
      expireInSeconds: job.expireInSeconds,
    };
    if (await boss.getQueue(job.name)) {
      await boss.updateQueue(job.name, queue);
    } else {
      await boss.createQueue(job.name, queue);
    }
  }
}

/**
 * Fila para quem só enfileira (web, CLI): o pg-boss sobe no primeiro uso,
 * sem atrasar a inicialização nem abrir conexões à toa.
 */
export class LazyPgBossJobQueue implements JobQueue {
  private boss: Promise<PgBoss> | null = null;

  constructor(private readonly options: Omit<PgBossOptions, 'role'>) {}

  private start(): Promise<PgBoss> {
    this.boss ??= startPgBoss({ ...this.options, role: 'producer' }).catch((error: unknown) => {
      this.boss = null;
      throw error;
    });
    return this.boss;
  }

  async enqueue(name: string, data: object, options: EnqueueOptions = {}): Promise<string | null> {
    return new PgBossJobQueue(await this.start()).enqueue(name, data, options);
  }

  async stop(): Promise<void> {
    if (this.boss) await (await this.boss).stop({ graceful: true, timeout: 5_000 });
  }
}

/** Implementação da porta JobQueue do core sobre o pg-boss. */
export class PgBossJobQueue implements JobQueue {
  constructor(private readonly boss: PgBoss) {}

  async enqueue(name: string, data: object, options: EnqueueOptions = {}): Promise<string | null> {
    return this.boss.send(name, data, {
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options.startAfter ? { startAfter: options.startAfter } : {}),
      ...(options.retryLimit !== undefined ? { retryLimit: options.retryLimit } : {}),
      // Mesma transação do dado de negócio: se ela for desfeita, o job também é.
      ...(options.tx ? { db: fromPrisma(options.tx) } : {}),
    });
  }
}
