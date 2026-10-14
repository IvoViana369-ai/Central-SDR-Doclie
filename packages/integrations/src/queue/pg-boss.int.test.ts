import { JOBS, silentLogger } from '@docline/core';
import { closeTestDb, getTestDb } from '@docline/db/testing';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgBossJobQueue, startPgBoss } from './pg-boss';

const db = getTestDb();
let boss: PgBoss;
let queue: PgBossJobQueue;
const NAME = JOBS.heartbeat.name;

beforeAll(async () => {
  boss = await startPgBoss({
    connectionString: process.env.DATABASE_URL_TEST!,
    schema: 'pgboss',
    role: 'producer',
    logger: silentLogger,
  });
  queue = new PgBossJobQueue(boss);
});

afterAll(async () => {
  await boss.stop({ graceful: false, close: true });
  await closeTestDb();
});

describe('PgBossJobQueue', () => {
  it('cria as filas do catálogo com a política definida', async () => {
    const created = await boss.getQueue(NAME);
    expect(created).toMatchObject({ name: NAME, retryLimit: JOBS.heartbeat.retryLimit });
  });

  it('enfileira fora de transação', async () => {
    const id = await queue.enqueue(NAME, { origem: 'teste' });
    expect(id).toBeTruthy();
    expect(await boss.findJobs(NAME, { id: id! })).toHaveLength(1);
  });

  it('job enfileirado em transação desfeita não existe (enfileiramento transacional)', async () => {
    let id: string | null = null;
    await expect(
      db.$transaction(async (tx) => {
        id = await queue.enqueue(NAME, { origem: 'rollback' }, { tx });
        throw new Error('falha de negócio');
      }),
    ).rejects.toThrow('falha de negócio');
    expect(id).toBeTruthy();
    expect(await boss.findJobs(NAME, { id: id! })).toHaveLength(0);
  });

  it('job enfileirado em transação confirmada existe', async () => {
    const id = await db.$transaction(async (tx) =>
      queue.enqueue(NAME, { origem: 'commit' }, { tx }),
    );
    expect(await boss.findJobs(NAME, { id: id! })).toHaveLength(1);
  });
});
