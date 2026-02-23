import { describe, it, expect, vi } from 'vitest';
import { dedup } from '../src/dedup.js';
import type { FingerprintedJob, NormalizedJob } from '../src/types.js';
import type { Database } from '@opencruit/db';

function makeFJ(sourceId: string, externalId: string, fingerprint: string): FingerprintedJob {
  return {
    fingerprint,
    job: {
      sourceId,
      externalId,
      url: 'https://example.com',
      title: 'Test',
      company: 'Test Co',
      description: 'Test description',
      _normalized: true as const,
    } as NormalizedJob,
  };
}

function mockDb(existingRows: Array<{ fingerprint: string; sourceId: string; id: string }>): Database {
  const orderBy = vi.fn().mockResolvedValue(existingRows);
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy }),
      }),
    }),
  } as unknown as Database;
}

describe('dedup', () => {
  it('returns insert for new fingerprints', async () => {
    const db = mockDb([]);
    const outcomes = await dedup([makeFJ('source-a', 'ext-1', 'fp-1')], db);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.action).toBe('insert');
  });

  it('returns skip when fingerprint exists from different source', async () => {
    const db = mockDb([{ fingerprint: 'fp-1', sourceId: 'source-b', id: 'uuid-1' }]);
    const outcomes = await dedup([makeFJ('source-a', 'ext-1', 'fp-1')], db);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.action).toBe('skip');
    if (outcomes[0]!.action === 'skip') {
      expect(outcomes[0]!.reason).toContain('source-b');
    }
  });

  it('returns update when fingerprint exists from same source', async () => {
    const db = mockDb([{ fingerprint: 'fp-1', sourceId: 'source-a', id: 'uuid-1' }]);
    const outcomes = await dedup([makeFJ('source-a', 'ext-1', 'fp-1')], db);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.action).toBe('update');
    if (outcomes[0]!.action === 'update') {
      expect(outcomes[0]!.existingId).toBe('uuid-1');
    }
  });

  it('handles empty input', async () => {
    const db = mockDb([]);
    const outcomes = await dedup([], db);
    expect(outcomes).toEqual([]);
  });

  it('handles multiple jobs with mixed outcomes', async () => {
    const db = mockDb([
      { fingerprint: 'fp-1', sourceId: 'source-b', id: 'uuid-1' },
      { fingerprint: 'fp-2', sourceId: 'source-a', id: 'uuid-2' },
    ]);
    const outcomes = await dedup(
      [makeFJ('source-a', 'ext-1', 'fp-1'), makeFJ('source-a', 'ext-2', 'fp-2'), makeFJ('source-a', 'ext-3', 'fp-3')],
      db,
    );
    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]!.action).toBe('skip'); // fp-1 from source-b
    expect(outcomes[1]!.action).toBe('update'); // fp-2 from source-a
    expect(outcomes[2]!.action).toBe('insert'); // fp-3 new
  });

  it('skips duplicate source/external pairs inside the same batch', async () => {
    const db = mockDb([]);
    const outcomes = await dedup([makeFJ('source-a', 'ext-1', 'fp-1'), makeFJ('source-a', 'ext-1', 'fp-2')], db);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.action).toBe('insert');
    expect(outcomes[1]!.action).toBe('skip');
    if (outcomes[1]!.action === 'skip') {
      expect(outcomes[1]!.reason).toContain('duplicate source/external in batch');
    }
  });

  it('skips duplicate fingerprints inside the same batch', async () => {
    const db = mockDb([]);
    const outcomes = await dedup([makeFJ('source-a', 'ext-1', 'fp-1'), makeFJ('source-b', 'ext-2', 'fp-1')], db);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.action).toBe('insert');
    expect(outcomes[1]!.action).toBe('skip');
    if (outcomes[1]!.action === 'skip') {
      expect(outcomes[1]!.reason).toContain('fingerprint duplicate in batch');
    }
  });

  it('uses deterministic winner when multiple sources already share a fingerprint', async () => {
    const db = mockDb([
      { fingerprint: 'fp-1', sourceId: 'source-b', id: 'uuid-1' },
      { fingerprint: 'fp-1', sourceId: 'source-c', id: 'uuid-2' },
    ]);
    const outcomes = await dedup([makeFJ('source-a', 'ext-1', 'fp-1')], db);

    expect(outcomes[0]!.action).toBe('skip');
    if (outcomes[0]!.action === 'skip') {
      expect(outcomes[0]!.reason).toContain('source-b:uuid-1');
    }
  });
});
