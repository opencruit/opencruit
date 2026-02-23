import { describe, it, expect, vi } from 'vitest';
import type { Database } from '@opencruit/db';
import type { DedupOutcome, NormalizedJob } from '../src/types.js';
import { computeNextCheckAt, store } from '../src/store.js';

function makeOutcome(
  action: 'insert' | 'update',
  sourceId: string,
  externalId: string,
  fingerprint: string,
  overrides: Partial<NormalizedJob> = {},
): DedupOutcome {
  const job: NormalizedJob = {
    sourceId,
    externalId,
    url: 'https://example.com/jobs/1',
    title: 'Engineer',
    company: 'Acme',
    description: 'Job description',
    ...overrides,
    _normalized: true as const,
  };

  if (action === 'update') {
    return { action, existingId: 'existing-id', job: { job, fingerprint } };
  }

  return { action, job: { job, fingerprint } };
}

function mockDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { insert } as unknown as Database,
    insert,
    values,
    onConflictDoUpdate,
  };
}

describe('store', () => {
  it('computes next check interval by job age', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-02-23T12:00:00.000Z'));

      const underTwoDays = new Date('2026-02-22T00:00:00.000Z');
      const underTwoWeeks = new Date('2026-02-18T00:00:00.000Z');
      const underMonth = new Date('2026-02-01T00:00:00.000Z');
      const oldJob = new Date('2025-12-31T00:00:00.000Z');

      expect(computeNextCheckAt(underTwoDays).toISOString()).toBe('2026-02-24T00:00:00.000Z');
      expect(computeNextCheckAt(underTwoWeeks).toISOString()).toBe('2026-02-24T12:00:00.000Z');
      expect(computeNextCheckAt(underMonth).toISOString()).toBe('2026-02-26T12:00:00.000Z');
      expect(computeNextCheckAt(oldJob).toISOString()).toBe('2026-03-02T12:00:00.000Z');
      expect(computeNextCheckAt(undefined).toISOString()).toBe('2026-02-24T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns zero counts when no upsertable outcomes exist', async () => {
    const { db, insert } = mockDb();
    const result = await store([], db);

    expect(result).toEqual({ plannedInserts: 0, plannedUpdates: 0, upserted: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('deduplicates source/external pairs before upsert', async () => {
    const { db, insert, values, onConflictDoUpdate } = mockDb();
    const outcomes: DedupOutcome[] = [
      makeOutcome('insert', 'source-a', 'ext-1', 'fp-1'),
      makeOutcome('update', 'source-a', 'ext-2', 'fp-2'),
      makeOutcome('insert', 'source-a', 'ext-1', 'fp-3'),
    ];

    const result = await store(outcomes, db);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);

    const [rows] = values.mock.calls[0]!;
    expect(rows).toHaveLength(2);
    expect(result).toEqual({ plannedInserts: 1, plannedUpdates: 1, upserted: 2 });
  });

  it('normalizes decimal salary values to database-safe integers', async () => {
    const { db, values } = mockDb();
    const outcomes: DedupOutcome[] = [
      makeOutcome('insert', 'source-a', 'ext-decimal', 'fp-decimal', {
        salary: {
          min: 39_998.4,
          max: 75_000.8,
          currency: 'USD',
        },
      }),
      makeOutcome('insert', 'source-a', 'ext-overflow', 'fp-overflow', {
        salary: {
          min: 99_999_999_999,
          max: -99_999_999_999,
          currency: 'USD',
        },
      }),
    ];

    await store(outcomes, db);

    const [rows] = values.mock.calls[0]!;
    expect(rows[0]?.salaryMin).toBe(39_998);
    expect(rows[0]?.salaryMax).toBe(75_001);
    expect(rows[1]?.salaryMin).toBeNull();
    expect(rows[1]?.salaryMax).toBeNull();
  });
});
