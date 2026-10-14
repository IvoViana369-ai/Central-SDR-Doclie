import { WORKER_HEARTBEAT_KEY } from '@docline/core';
import { closeTestDb, getTestDb, resetTestData } from '@docline/db/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { recordHeartbeat } from './heartbeat';

const db = getTestDb();

describe('recordHeartbeat', () => {
  beforeEach(() => resetTestData(db));
  afterAll(() => closeTestDb());

  it('grava e atualiza o sinal de vida do worker', async () => {
    const startedAt = new Date('2026-10-13T12:00:00Z');
    await recordHeartbeat(db, startedAt, new Date('2026-10-13T12:01:00Z'));
    await recordHeartbeat(db, startedAt, new Date('2026-10-13T12:02:00Z'));
    const setting = await db.appSetting.findUniqueOrThrow({ where: { key: WORKER_HEARTBEAT_KEY } });
    expect(setting.value).toMatchObject({
      at: '2026-10-13T12:02:00.000Z',
      startedAt: '2026-10-13T12:00:00.000Z',
    });
    expect(await db.appSetting.count()).toBe(1);
  });
});
