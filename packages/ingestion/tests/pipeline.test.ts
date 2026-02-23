import { describe, it, expect, vi } from 'vitest';
import type { Database } from '@opencruit/db';
import { ingestBatch } from '../src/pipeline.js';

function createDbMock(existingRows: Array<{ fingerprint: string; sourceId: string; id: string }> = []) {
  const orderBy = vi.fn().mockResolvedValue(existingRows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { select, insert } as unknown as Database,
    select,
    orderBy,
    where,
    insert,
    values,
    onConflictDoUpdate,
  };
}

describe('ingestBatch', () => {
  it('processes a valid batch and stores jobs', async () => {
    const { db, insert, values } = createDbMock();
    const rawJobs = [
      {
        sourceId: 'source-a',
        externalId: 'source-a:1',
        url: 'https://example.com/jobs/1',
        title: 'Engineer',
        company: 'Acme',
        description: 'Great role',
      },
    ];

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = await ingestBatch(rawJobs, db, { sourceId: 'source-a', logger });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(result.errors).toHaveLength(0);
    expect(result.stats.received).toBe(1);
    expect(result.stats.validated).toBe(1);
    expect(result.stats.upserted).toBe(1);
  });

  it('returns error when downstream stage throws', async () => {
    const orderBy = vi.fn().mockRejectedValue(new Error('db read failed'));
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select, insert: vi.fn() } as unknown as Database;

    const result = await ingestBatch(
      [
        {
          sourceId: 'source-a',
          externalId: 'source-a:1',
          url: 'https://example.com/jobs/1',
          title: 'Engineer',
          company: 'Acme',
          description: 'Great role',
        },
      ],
      db,
      { sourceId: 'source-a' },
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('db read failed');
    expect(result.stats.received).toBe(1);
    expect(result.stats.upserted).toBe(0);
  });

  it('reports validation drops for invalid jobs and skips store', async () => {
    const { db, insert } = createDbMock();
    const rawJobs = [
      {
        sourceId: 'invalid-source',
        externalId: 'invalid-source:1',
        url: 'not-a-url',
        title: 'Engineer',
        company: 'Acme',
        description: 'Great role',
      },
    ];

    const result = await ingestBatch(rawJobs, db, { sourceId: 'invalid-source' });

    expect(insert).not.toHaveBeenCalled();
    expect(result.stats.received).toBe(1);
    expect(result.stats.validated).toBe(0);
    expect(result.stats.validationDropped).toBe(1);
    expect(result.stats.upserted).toBe(0);
  });
});
