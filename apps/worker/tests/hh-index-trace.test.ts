import type { Database } from '@opencruit/db';
import type { Job, Queue } from 'bullmq';
import type { HhClient, HhSearchResponse } from '@opencruit/parser-hh';
import { describe, expect, it, vi } from 'vitest';
import { handleHhIndexJob } from '../src/jobs/hh-index.js';
import type { HhHydrateJobData, HhIndexJobData } from '../src/queues.js';

function createDbMock() {
  const limit = vi.fn().mockResolvedValue([]);
  const whereSelect = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where: whereSelect });
  const select = vi.fn().mockReturnValue({ from });

  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: {
      select,
      insert,
    } as unknown as Database,
  };
}

function createSearchResponse(): HhSearchResponse {
  return {
    items: [
      {
        id: '999',
        name: 'Backend Engineer',
        url: 'https://api.hh.ru/vacancies/999',
        alternate_url: 'https://hh.ru/vacancy/999',
        published_at: '2026-02-23T10:00:00+0300',
        created_at: '2026-02-23T10:00:00+0300',
        archived: false,
      },
    ],
    found: 1,
    pages: 1,
    page: 0,
    per_page: 100,
  };
}

describe('handleHhIndexJob trace propagation', () => {
  it('forwards trace id to hydrate jobs', async () => {
    const { db } = createDbMock();
    const hydrateQueue = { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue<HhHydrateJobData>;
    const indexQueue = { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queue<HhIndexJobData>;
    const client = {
      searchVacancies: vi.fn().mockResolvedValue(createSearchResponse()),
    } as unknown as HhClient;

    const job = {
      data: {
        professionalRole: '96',
        dateFromIso: '2026-02-22T00:00:00.000Z',
        dateToIso: '2026-02-23T00:00:00.000Z',
      },
    } as Job<HhIndexJobData>;

    const result = await handleHhIndexJob(job, {
      client,
      db,
      hydrateQueue,
      indexQueue,
    });

    expect(result.split).toBe(false);
    expect(job.data.traceId).toBeTruthy();
    expect(vi.mocked(hydrateQueue.add)).toHaveBeenCalledWith(
      'hh-hydrate',
      expect.objectContaining({
        vacancyId: '999',
        reason: 'new',
        traceId: job.data.traceId,
      }),
      expect.any(Object),
    );
  });
});
