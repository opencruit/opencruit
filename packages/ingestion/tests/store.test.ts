import { describe, it, expect, vi } from 'vitest';
import type { Database } from '@opencruit/db';
import type { DedupOutcome, NormalizedJob } from '../src/types.js';
import { store } from '../src/store.js';

function makeOutcome(
  action: 'insert' | 'update',
  sourceId: string,
  externalId: string,
  fingerprint: string,
): DedupOutcome {
  const job: NormalizedJob = {
    sourceId,
    externalId,
    url: 'https://example.com/jobs/1',
    title: 'Engineer',
    company: 'Acme',
    description: 'Job description',
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
});
