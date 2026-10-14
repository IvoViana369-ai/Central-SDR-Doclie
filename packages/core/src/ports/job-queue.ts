import type { DbTransaction } from '@docline/db';

export interface EnqueueOptions {
  /** Enfileira na mesma transação do dado de negócio (docs/ARCHITECTURE.md §7.2). */
  tx?: DbTransaction;
  /** Evita duplicidade: só um job ativo com a mesma chave. */
  singletonKey?: string;
  startAfter?: Date;
  retryLimit?: number;
}

/** Fila de jobs assíncronos executados pelo worker. */
export interface JobQueue {
  enqueue(name: string, data: object, options?: EnqueueOptions): Promise<string | null>;
}
