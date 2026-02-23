import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { withLogger } from '../../src/observability/with-logger.js';

function createLoggerMock(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe('withLogger', () => {
  it('logs start/completion and returns handler result', async () => {
    const logger = createLoggerMock();
    const job = {
      id: 'job-1',
      name: 'source-ingest',
      attemptsMade: 0,
      timestamp: Date.now() - 250,
      data: {},
    } as Job<{ traceId?: string }>;

    const result = await withLogger({
      logger,
      queue: 'source.ingest',
      job,
      context: () => ({ parserId: 'remoteok' }),
      summary: () => ({ upserted: 5 }),
      run: async () => ({ ok: true }),
    });

    expect(result).toEqual({ ok: true });
    expect(job.data.traceId).toBeTruthy();
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(2);

    const [startPayload] = vi.mocked(logger.info).mock.calls[0]!;
    expect(startPayload).toMatchObject({
      event: 'job_started',
      queue: 'source.ingest',
      parserId: 'remoteok',
    });

    const [completedPayload] = vi.mocked(logger.info).mock.calls[1]!;
    expect(completedPayload).toMatchObject({
      event: 'job_completed',
      queue: 'source.ingest',
      upserted: 5,
    });
  });

  it('logs failure and rethrows', async () => {
    const logger = createLoggerMock();
    const job = {
      id: 'job-2',
      name: 'hh-hydrate',
      attemptsMade: 1,
      timestamp: Date.now() - 100,
      data: {},
    } as Job<{ traceId?: string }>;

    await expect(
      withLogger({
        logger,
        queue: 'hh.hydrate',
        job,
        run: async () => {
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');

    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1);
    const [errorPayload] = vi.mocked(logger.error).mock.calls[0]!;
    expect(errorPayload).toMatchObject({
      event: 'job_failed',
      queue: 'hh.hydrate',
    });
  });
});
