import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../src/index.js';
import { rawJobSchema } from '@opencruit/parser-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/response.json'), 'utf-8'));

function mockFetch(status: number, payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Greenhouse parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses and filters to tech jobs', async () => {
    const fetchMock = mockFetch(200, fixture);

    const result = await parse({
      boards: ['demo'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.jobs.length).toBe(1);
    const job = result.jobs[0]!;
    expect(job.sourceId).toBe('greenhouse');
    expect(job.externalId).toBe('greenhouse:demo:1001');
    expect(job.company).toBe('Demo Co');
  });

  it('returns empty list on unknown board (404)', async () => {
    mockFetch(404, {});

    const result = await parse({ boards: ['missing-board'] });
    expect(result.jobs).toEqual([]);
  });

  it('requires boards in parse config', async () => {
    await expect(parse({ boards: [] })).rejects.toThrow('Greenhouse parser requires at least one board token');
  });

  it('returns jobs compatible with RawJob schema', async () => {
    mockFetch(200, fixture);

    const result = await parse({ boards: ['demo'] });

    for (const job of result.jobs) {
      const parsed = rawJobSchema.safeParse(job);
      if (!parsed.success) {
        expect.fail(`Job "${job.title}" failed schema validation: ${JSON.stringify(parsed.error.issues)}`);
      }
    }
  });
});
