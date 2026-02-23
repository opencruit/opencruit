import type { HhClient } from '@opencruit/parser-hh';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queues } from '../src/queues.js';
import { scheduleAllSources } from '../src/scheduler.js';
import { getBatchSources, getWorkflowSources } from '../src/sources/catalog.js';

vi.mock('../src/sources/catalog.js', () => ({
  getBatchSources: vi.fn(),
  getWorkflowSources: vi.fn(),
}));

const getBatchSourcesMock = vi.mocked(getBatchSources);
const getWorkflowSourcesMock = vi.mocked(getWorkflowSources);

function createQueuesMock(): Queues {
  return {
    sourceIngestQueue: { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queues['sourceIngestQueue'],
    indexQueue: { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queues['indexQueue'],
    hydrateQueue: { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queues['hydrateQueue'],
    refreshQueue: { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queues['refreshQueue'],
    sourceGcQueue: { add: vi.fn().mockResolvedValue(undefined) } as unknown as Queues['sourceGcQueue'],
  };
}

describe('scheduleAllSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SOURCE_SCHEDULE_REMOTEOK;
  });

  it('falls back to parser manifest schedule when env override is empty', async () => {
    process.env.SOURCE_SCHEDULE_REMOTEOK = '';
    const setupScheduler = vi.fn().mockResolvedValue({
      stats: {
        roleCount: 12,
      },
    });

    getBatchSourcesMock.mockReturnValue([
      {
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
          parse: vi.fn(),
        },
      },
    ]);

    getWorkflowSourcesMock.mockReturnValue([
      {
        id: 'hh',
        kind: 'workflow',
        pool: 'light',
        runtime: {
          attempts: 4,
          backoffMs: 5000,
        },
        setupScheduler,
      },
    ]);

    const queues = createQueuesMock();
    const hhClient = {} as unknown as HhClient;

    const result = await scheduleAllSources(queues, hhClient, {
      bootstrapIndexNow: false,
    });

    expect(result.workflowErrors).toEqual([]);
    expect(result.scheduledBatchSources).toBe(1);
    expect(result.scheduledWorkflowSources).toBe(1);
    expect(result.workflowStats).toEqual({
      hh: {
        roleCount: 12,
      },
    });

    expect(vi.mocked(queues.sourceIngestQueue.add)).toHaveBeenCalledWith(
      'source-ingest',
      { sourceId: 'remoteok' },
      expect.objectContaining({
        repeat: {
          pattern: '0 */4 * * *',
        },
      }),
    );
    expect(setupScheduler).toHaveBeenCalledTimes(1);
  });

  it('keeps batch and gc scheduling when workflow scheduling fails', async () => {
    getBatchSourcesMock.mockReturnValue([
      {
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
          parse: vi.fn(),
        },
      },
    ]);

    getWorkflowSourcesMock.mockReturnValue([
      {
        id: 'hh',
        kind: 'workflow',
        pool: 'light',
        runtime: {
          attempts: 4,
          backoffMs: 5000,
        },
        setupScheduler: vi.fn().mockRejectedValue(new Error('hh down')),
      },
    ]);

    const queues = createQueuesMock();
    const hhClient = {} as unknown as HhClient;

    const result = await scheduleAllSources(queues, hhClient);

    expect(result.scheduledBatchSources).toBe(1);
    expect(result.scheduledWorkflowSources).toBe(0);
    expect(result.workflowErrors).toEqual([
      {
        sourceId: 'hh',
        error: 'hh down',
      },
    ]);

    expect(vi.mocked(queues.sourceIngestQueue.add)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queues.sourceGcQueue.add)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(queues.indexQueue.add)).not.toHaveBeenCalled();
    expect(vi.mocked(queues.refreshQueue.add)).not.toHaveBeenCalled();
  });
});
