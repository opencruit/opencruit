import type { Database } from '@opencruit/db';
import { describe, expect, it, vi } from 'vitest';
import { recordSourceHealthFailure, recordSourceHealthSuccess } from '../src/observability/source-health.js';

function createDbMock(): {
  db: Database;
  insert: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
} {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: {
      insert,
    } as unknown as Database,
    insert,
    values,
    onConflictDoUpdate,
  };
}

describe('source health updates', () => {
  it('writes healthy state and resets failures on success', async () => {
    const { db, values, onConflictDoUpdate } = createDbMock();

    await recordSourceHealthSuccess(db, {
      sourceId: 'remoteok',
      stage: 'ingest',
      durationMs: 120,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'remoteok',
        stage: 'ingest',
        status: 'healthy',
        consecutiveFailures: 0,
        lastDurationMs: 120,
        lastError: null,
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          status: 'healthy',
          consecutiveFailures: 0,
          lastDurationMs: 120,
          lastError: null,
        }),
      }),
    );
  });

  it('writes failing state, increments failures, and truncates large error text', async () => {
    const { db, values, onConflictDoUpdate } = createDbMock();
    const largeError = new Error('x'.repeat(5000));

    await recordSourceHealthFailure(db, {
      sourceId: 'hh',
      stage: 'hydrate',
      durationMs: 900,
      error: largeError,
    });

    const inserted = vi.mocked(values).mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      sourceId: 'hh',
      stage: 'hydrate',
      status: 'failing',
      consecutiveFailures: 1,
      lastDurationMs: 900,
    });
    expect(inserted?.lastError).toHaveLength(4000);

    const conflictOptions = vi.mocked(onConflictDoUpdate).mock.calls[0]?.[0];
    expect(conflictOptions).toMatchObject({
      set: expect.objectContaining({
        status: 'failing',
        lastDurationMs: 900,
      }),
    });
    expect(conflictOptions?.set?.consecutiveFailures).toBeTruthy();
  });
});
