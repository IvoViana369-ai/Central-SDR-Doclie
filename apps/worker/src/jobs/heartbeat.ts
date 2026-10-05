import { WORKER_HEARTBEAT_KEY } from '@docline/core';
import type { DbClient } from '@docline/db';

export interface HeartbeatValue {
  at: string;
  pid: number;
  startedAt: string;
}

/** Grava o sinal de vida do worker (lido pelo /api/health do web). */
export async function recordHeartbeat(
  db: DbClient,
  startedAt: Date,
  now = new Date(),
): Promise<HeartbeatValue> {
  const value: HeartbeatValue = {
    at: now.toISOString(),
    pid: process.pid,
    startedAt: startedAt.toISOString(),
  };
  await db.appSetting.upsert({
    where: { key: WORKER_HEARTBEAT_KEY },
    create: { key: WORKER_HEARTBEAT_KEY, value: { ...value } },
    update: { value: { ...value } },
  });
  return value;
}
