import type { Database } from '@opencruit/db';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { handleSourceGcJob } from '../src/jobs/source-gc.js';
import type { SourceGcJobData } from '../src/queues.js';

function createArchiveDbMock(archivedRowsCount: number) {
  const returning = vi.fn().mockResolvedValue(Array.from({ length: archivedRowsCount }, (_, idx) => ({ id: String(idx) })));
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const selectDistinct = vi.fn();
  const del = vi.fn();

  return {
    db: {
      update,
      selectDistinct,
      delete: del,
    } as unknown as Database,
    update,
    selectDistinct,
  };
}

function createDeleteDbMock(sourceIds: string[]) {
  const from = vi.fn().mockResolvedValue(sourceIds.map((sourceId) => ({ sourceId })));
  const selectDistinct = vi.fn().mockReturnValue({ from });

  const deleteReturning = vi.fn().mockResolvedValue([{ id: '1' }]);
  const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
  const del = vi.fn().mockReturnValue({ where: deleteWhere });

  const update = vi.fn();

  return {
    db: {
      selectDistinct,
      delete: del,
      update,
    } as unknown as Database,
    del,
    deleteWhere,
    deleteReturning,
    selectDistinct,
  };
}

describe('handleSourceGcJob', () => {
  it('archives stale jobs for explicit source', async () => {
    const { db, update, selectDistinct } = createArchiveDbMock(2);
    const job = { data: { mode: 'archive', sourceId: 'hh' } } as Job<SourceGcJobData>;

    const result = await handleSourceGcJob(job, { db });

    expect(selectDistinct).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      archived: 2,
      deleted: 0,
      processedSources: 1,
    });
  });

  it('deletes expired jobs for all known and discovered sources', async () => {
    const { db, del, selectDistinct } = createDeleteDbMock(['customsource']);
    const job = { data: { mode: 'delete' } } as Job<SourceGcJobData>;

    const result = await handleSourceGcJob(job, { db });

    expect(selectDistinct).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(4);
    expect(result).toEqual({
      archived: 0,
      deleted: 4,
      processedSources: 4,
    });
  });
});
