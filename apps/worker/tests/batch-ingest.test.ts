import type { Database } from '@opencruit/db';
import { ingestBatch } from '@opencruit/ingestion';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBatchIngestJob } from '../src/jobs/batch-ingest.js';
import { getParser } from '../src/registry.js';
import type { SourceIngestJobData } from '../src/queues.js';

vi.mock('@opencruit/ingestion', async () => {
  const actual = await vi.importActual<typeof import('@opencruit/ingestion')>('@opencruit/ingestion');
  return {
    ...actual,
    ingestBatch: vi.fn(),
  };
});

vi.mock('../src/registry.js', () => ({
  getParser: vi.fn(),
}));

const ingestBatchMock = vi.mocked(ingestBatch);
const getParserMock = vi.mocked(getParser);

function createLoggerMock(): Logger {
  const child = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child,
  } as unknown as Logger;
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

    getParserMock.mockReturnValue({
      manifest: {
        id: 'remoteok',
        name: 'RemoteOK',
        version: '0.1.0',
        schedule: '0 */4 * * *',
      },
      parse,
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

    const job = { data: { parserId: 'remoteok' } } as Job<SourceIngestJobData>;
    const db = {} as Database;

    const result = await handleBatchIngestJob(job, { db, logger: createLoggerMock() });

    expect(getParserMock).toHaveBeenCalledWith('remoteok');
    expect(parse).toHaveBeenCalledTimes(1);
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

  it('fails when parser id is unknown', async () => {
    getParserMock.mockImplementation(() => {
      throw new Error('Unknown parser id: unknown');
    });

    const job = { data: { parserId: 'unknown' } } as Job<SourceIngestJobData>;

    await expect(handleBatchIngestJob(job, { db: {} as Database, logger: createLoggerMock() })).rejects.toThrow(
      'Unknown parser id: unknown',
    );
    expect(ingestBatchMock).not.toHaveBeenCalled();
  });

  it('fails when ingest pipeline returns errors', async () => {
    getParserMock.mockReturnValue({
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

    const job = { data: { parserId: 'remoteok' } } as Job<SourceIngestJobData>;
    await expect(handleBatchIngestJob(job, { db: {} as Database, logger: createLoggerMock() })).rejects.toThrow(
      '[source.ingest:remoteok] db failed',
    );
  });
});
