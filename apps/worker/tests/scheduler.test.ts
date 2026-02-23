import type { HhClient } from '@opencruit/parser-hh';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queues } from '../src/queues.js';
import { scheduleAllSources } from '../src/scheduler.js';
import { getBatchSources, getWorkflowSources } from '../src/sources/catalog.js';
import { stub } from './test-helpers.js';

vi.mock('../src/sources/catalog.js', () => ({
  getBatchSources: vi.fn(),
  getWorkflowSources: vi.fn(),
}));

const getBatchSourcesMock = vi.mocked(getBatchSources);
const getWorkflowSourcesMock = vi.mocked(getWorkflowSources);

function createQueuesMock(): Queues {
  return {
    sourceIngestQueue: stub<Queues['sourceIngestQueue']>({ add: vi.fn().mockResolvedValue(undefined) }),
    indexQueue: stub<Queues['indexQueue']>({ add: vi.fn().mockResolvedValue(undefined) }),
    hydrateQueue: stub<Queues['hydrateQueue']>({ add: vi.fn().mockResolvedValue(undefined) }),
    refreshQueue: stub<Queues['refreshQueue']>({ add: vi.fn().mockResolvedValue(undefined) }),
    sourceGcQueue: stub<Queues['sourceGcQueue']>({ add: vi.fn().mockResolvedValue(undefined) }),
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
    const hhClient = stub<HhClient>({});

    const result = await scheduleAllSources(queues, hhClient, {
      bootstrapIndexNow: false,
    });

    expect(result.batchErrors).toEqual([]);
    expect(result.disabledSources).toEqual([]);
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
    const hhClient = stub<HhClient>({});

    const result = await scheduleAllSources(queues, hhClient);

    expect(result.batchErrors).toEqual([]);
    expect(result.disabledSources).toEqual([]);
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

  it('keeps workflow scheduling when one batch source fails', async () => {
    const setupScheduler = vi.fn().mockResolvedValue({});

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
            schedule: '',
          },
          parse: vi.fn(),
        },
      },
      {
        id: 'remotive',
        kind: 'batch',
        pool: 'light',
        runtime: {
          attempts: 3,
          backoffMs: 5000,
        },
        parser: {
          manifest: {
            id: 'remotive',
            name: 'Remotive',
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
    const hhClient = {} as HhClient;

    const result = await scheduleAllSources(queues, hhClient);

    expect(result.scheduledBatchSources).toBe(1);
    expect(result.disabledSources).toEqual([]);
    expect(result.batchErrors).toEqual([
      {
        sourceId: 'remoteok',
        error: 'Source remoteok has no schedule configured',
      },
    ]);
    expect(result.scheduledWorkflowSources).toBe(1);
    expect(result.workflowErrors).toEqual([]);
    expect(vi.mocked(queues.sourceIngestQueue.add)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queues.sourceGcQueue.add)).toHaveBeenCalledTimes(2);
    expect(setupScheduler).toHaveBeenCalledTimes(1);
  });

  it('disables batch source when required env is missing', async () => {
    const setupScheduler = vi.fn().mockResolvedValue({});

    getBatchSourcesMock.mockReturnValue([
      {
        id: 'adzuna',
        kind: 'batch',
        pool: 'light',
        runtime: {
          attempts: 3,
          backoffMs: 5000,
        },
        requiredEnv: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
        parser: {
          manifest: {
            id: 'adzuna',
            name: 'Adzuna',
            version: '0.1.0',
            schedule: '0 */6 * * *',
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

    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;

    const queues = createQueuesMock();
    const hhClient = stub<HhClient>({});

    const result = await scheduleAllSources(queues, hhClient);

    expect(result.scheduledBatchSources).toBe(0);
    expect(result.batchErrors).toEqual([]);
    expect(result.disabledSources).toEqual([
      {
        sourceId: 'adzuna',
        reason: 'Missing required environment variables: ADZUNA_APP_ID, ADZUNA_APP_KEY',
      },
    ]);
    expect(result.scheduledWorkflowSources).toBe(1);
    expect(vi.mocked(queues.sourceIngestQueue.add)).not.toHaveBeenCalled();
    expect(vi.mocked(queues.sourceGcQueue.add)).toHaveBeenCalledTimes(2);
  });
});
