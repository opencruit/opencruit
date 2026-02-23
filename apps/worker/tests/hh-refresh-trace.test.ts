import type { Database } from '@opencruit/db';
import type { Job, Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { handleHhRefreshJob } from '../src/jobs/hh-refresh.js';
import type { HhHydrateJobData, HhRefreshJobData } from '../src/queues.js';

function createDbMock() {
  const limit = vi.fn().mockResolvedValue([{ externalId: 'hh:123' }]);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const whereSelect = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where: whereSelect });
  const select = vi.fn().mockReturnValue({ from });

  const whereUpdate = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where: whereUpdate });
  const update = vi.fn().mockReturnValue({ set });

  return {
    db: {
      select,
      update,
    } as unknown as Database,
    select,
    update,
  };
}

describe('handleHhRefreshJob trace propagation', () => {
  it('sets trace id and forwards it to hydrate job data', async () => {
    const { db } = createDbMock();
    const add = vi.fn().mockResolvedValue(undefined);
    const hydrateQueue = { add } as unknown as Queue<HhHydrateJobData>;

    const job = { data: { batchSize: 1 } } as Job<HhRefreshJobData>;

    const result = await handleHhRefreshJob(job, { db, hydrateQueue });

    expect(result).toEqual({
      selected: 1,
      enqueued: 1,
    });
    expect(job.data.traceId).toBeTruthy();
    expect(add).toHaveBeenCalledWith(
      'hh-hydrate',
      expect.objectContaining({
        vacancyId: '123',
        reason: 'refresh',
        traceId: job.data.traceId,
      }),
      expect.any(Object),
    );
  });
});
