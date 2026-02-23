import type { HhClient } from '@opencruit/parser-hh';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queues } from '../src/queues.js';
import { scheduleAllSources } from '../src/scheduler.js';
import { getAllParsers } from '../src/registry.js';

vi.mock('../src/registry.js', () => ({
  getAllParsers: vi.fn(),
}));

const getAllParsersMock = vi.mocked(getAllParsers);

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
    delete process.env.PARSER_SCHEDULE_REMOTEOK;
  });

  it('falls back to manifest schedule when env override is empty', async () => {
    process.env.PARSER_SCHEDULE_REMOTEOK = '';
    getAllParsersMock.mockReturnValue([
      {
        manifest: {
          id: 'remoteok',
          name: 'RemoteOK',
          version: '0.1.0',
          schedule: '0 */4 * * *',
        },
        parse: vi.fn(),
      },
    ]);

    const queues = createQueuesMock();
    const hhClient = { getItRoleIds: vi.fn().mockResolvedValue(['96']) } as unknown as HhClient;

    const result = await scheduleAllSources(queues, hhClient, {
      bootstrapIndexNow: false,
    });

    expect(result.hhSchedulingSucceeded).toBe(true);
    expect(vi.mocked(queues.sourceIngestQueue.add)).toHaveBeenCalledWith(
      'source-ingest',
      { parserId: 'remoteok' },
      expect.objectContaining({
        repeat: {
          pattern: '0 */4 * * *',
        },
      }),
    );
  });

  it('keeps batch and gc scheduling when HH scheduling fails', async () => {
    getAllParsersMock.mockReturnValue([
      {
        manifest: {
          id: 'remoteok',
          name: 'RemoteOK',
          version: '0.1.0',
          schedule: '0 */4 * * *',
        },
        parse: vi.fn(),
      },
    ]);

    const queues = createQueuesMock();
    const hhClient = { getItRoleIds: vi.fn().mockRejectedValue(new Error('hh down')) } as unknown as HhClient;

    const result = await scheduleAllSources(queues, hhClient);

    expect(result.hhSchedulingSucceeded).toBe(false);
    expect(result.hhError).toContain('hh down');
    expect(vi.mocked(queues.sourceIngestQueue.add)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queues.sourceGcQueue.add)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(queues.indexQueue.add)).not.toHaveBeenCalled();
    expect(vi.mocked(queues.refreshQueue.add)).not.toHaveBeenCalled();
  });
});
