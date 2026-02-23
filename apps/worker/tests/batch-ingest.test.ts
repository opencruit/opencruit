import type { Database } from '@opencruit/db';
import { ingestBatch } from '@opencruit/ingestion';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBatchIngestJob } from '../src/jobs/batch-ingest.js';
import { getSourceById } from '../src/sources/catalog.js';
import type { SourceIngestJobData } from '../src/queues.js';
import { stub } from './test-helpers.js';

vi.mock('@opencruit/ingestion', async () => {
  const actual = await vi.importActual<typeof import('@opencruit/ingestion')>('@opencruit/ingestion');
  return {
    ...actual,
    ingestBatch: vi.fn(),
  };
});

vi.mock('../src/sources/catalog.js', () => ({
  getSourceById: vi.fn(),
}));

const ingestBatchMock = vi.mocked(ingestBatch);
const getSourceByIdMock = vi.mocked(getSourceById);

function createLoggerMock(): Logger {
  const child = vi.fn();
  const logger = stub<Logger>({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child,
  });
  child.mockReturnValue(logger);

  return logger;
}

describe('handleBatchIngestJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs parser and forwards jobs to ingestBatch', async () => {
    const parse = vi.fn().mockResolvedValue({
      jobs: [
        {
          sourceId: 'remoteok',
          externalId: 'remoteok:1',
          url: 'https://example.com/job/1',
          title: 'Engineer',
          company: 'Acme',
          description: 'Hello',
        },
      ],
    });

    getSourceByIdMock.mockReturnValue({
      id: 'remoteok',
      kind: 'batch',
      pool: 'light',
      runtime: {
        attempts: 3,
        backoffMs: 5000,
      },
      resolveParseConfig: () => ({
        country: 'us',
      }),
      parser: {
        manifest: {
          id: 'remoteok',
          name: 'RemoteOK',
          version: '0.1.0',
          schedule: '0 */4 * * *',
        },
        parse,
      },
    });

    ingestBatchMock.mockResolvedValue({
      sourceId: 'remoteok',
      stats: {
        received: 1,
        validated: 1,
        validationDropped: 0,
        normalized: 1,
        fingerprinted: 1,
        dedupPlannedInserts: 1,
        dedupPlannedUpdates: 0,
        dedupSkipped: 0,
        upserted: 1,
      },
      errors: [],
      durationMs: 10,
    });

    const job = { data: { sourceId: 'remoteok' } } as Job<SourceIngestJobData>;
    const db = stub<Database>({});

    const result = await handleBatchIngestJob(job, { db, logger: createLoggerMock() });

    expect(getSourceByIdMock).toHaveBeenCalledWith('remoteok');
    expect(parse).toHaveBeenCalledWith({
      country: 'us',
    });
    expect(ingestBatchMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'remoteok',
        }),
      ]),
      db,
      expect.objectContaining({
        sourceId: 'remoteok',
      }),
    );
    expect(result.stats.upserted).toBe(1);
  });

  it('fails when source id is unknown', async () => {
    getSourceByIdMock.mockImplementation(() => {
      throw new Error('Unknown source id: unknown');
    });

    const job = { data: { sourceId: 'unknown' } } as Job<SourceIngestJobData>;

    await expect(handleBatchIngestJob(job, { db: stub<Database>({}), logger: createLoggerMock() })).rejects.toThrow(
      'Unknown source id: unknown',
    );
    expect(ingestBatchMock).not.toHaveBeenCalled();
  });

  it('fails when ingest pipeline returns errors', async () => {
    getSourceByIdMock.mockReturnValue({
      id: 'remoteok',
      kind: 'batch',
      pool: 'light',
      runtime: {
        attempts: 3,
        backoffMs: 5000,
      },
      parser: {
        manifest: {
          id: 'remoteok',
          name: 'RemoteOK',
          version: '0.1.0',
          schedule: '0 */4 * * *',
        },
        parse: vi.fn().mockResolvedValue({
          jobs: [
            {
              sourceId: 'remoteok',
              externalId: 'remoteok:1',
              url: 'https://example.com/job/1',
              title: 'Engineer',
              company: 'Acme',
              description: 'Hello',
            },
          ],
        }),
      },
    });

    ingestBatchMock.mockResolvedValue({
      sourceId: 'remoteok',
      stats: {
        received: 1,
        validated: 1,
        validationDropped: 0,
        normalized: 1,
        fingerprinted: 1,
        dedupPlannedInserts: 0,
        dedupPlannedUpdates: 0,
        dedupSkipped: 0,
        upserted: 0,
      },
      errors: ['db failed'],
      durationMs: 12,
    });

    const job = { data: { sourceId: 'remoteok' } } as Job<SourceIngestJobData>;
    await expect(handleBatchIngestJob(job, { db: stub<Database>({}), logger: createLoggerMock() })).rejects.toThrow(
      '[source.ingest:remoteok] db failed',
    );
  });

  it('fails when source is not a batch source', async () => {
    getSourceByIdMock.mockReturnValue({
      id: 'hh',
      kind: 'workflow',
      pool: 'light',
      runtime: {
        attempts: 4,
        backoffMs: 5000,
      },
      setupScheduler: vi.fn(),
    });

    const job = { data: { sourceId: 'hh' } } as Job<SourceIngestJobData>;

    await expect(handleBatchIngestJob(job, { db: stub<Database>({}), logger: createLoggerMock() })).rejects.toThrow(
      'Source hh is not a batch source',
    );
    expect(ingestBatchMock).not.toHaveBeenCalled();
  });
});
