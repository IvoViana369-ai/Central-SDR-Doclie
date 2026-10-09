import { ALL_JOBS, type CoreDeps } from '@docline/core';
import { describe, expect, it } from 'vitest';
import { jobHandlers } from './handlers';

describe('jobHandlers', () => {
  it('todo job do catálogo tem handler (e nenhum handler sobra)', () => {
    const handlers = jobHandlers({} as CoreDeps, new Date());
    expect(Object.keys(handlers).sort()).toEqual(ALL_JOBS.map((j) => j.name).sort());
  });

  it('dados inválidos são recusados antes de tocar no banco', async () => {
    const handlers = jobHandlers({} as CoreDeps, new Date());
    await expect(handlers['import.commit']!({ batchId: 'x' })).rejects.toThrow();
    await expect(handlers['dedup.check-lead']!({ leadIds: [] })).rejects.toThrow();
  });
});
