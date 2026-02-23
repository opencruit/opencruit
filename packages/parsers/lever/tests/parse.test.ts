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

describe('Lever parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses and filters to tech jobs', async () => {
    const fetchMock = mockFetch(200, fixture);

    const result = await parse({
      sites: ['demo'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.jobs.length).toBe(1);
    const job = result.jobs[0]!;
    expect(job.sourceId).toBe('lever');
    expect(job.externalId).toBe('lever:demo:2001');
    expect(job.company).toBe('demo');
    expect(job.isRemote).toBe(true);
  });

  it('returns empty list on unknown site (404)', async () => {
    mockFetch(404, {});

    const result = await parse({ sites: ['missing-site'] });
    expect(result.jobs).toEqual([]);
  });

  it('requires sites in parse config', async () => {
    await expect(parse({ sites: [] })).rejects.toThrow('Lever parser requires at least one site');
  });

  it('returns jobs compatible with RawJob schema', async () => {
    mockFetch(200, fixture);

    const result = await parse({ sites: ['demo'] });

    for (const job of result.jobs) {
      const parsed = rawJobSchema.safeParse(job);
      if (!parsed.success) {
        expect.fail(`Job "${job.title}" failed schema validation: ${JSON.stringify(parsed.error.issues)}`);
      }
    }
  });
});
