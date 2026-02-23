import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../src/index.js';
import { rawJobSchema } from '@opencruit/parser-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/response.json'), 'utf-8'));

interface MockFetchResponse {
  ok: boolean;
  status?: number;
  json?: unknown;
}

function mockFetchSequence(responses: MockFetchResponse[]) {
  let idx = 0;
  const fetchMock = vi.fn().mockImplementation(() => {
    const response = responses[Math.min(idx, responses.length - 1)]!;
    idx += 1;

    return Promise.resolve({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () => Promise.resolve(response.json),
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Adzuna parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses and filters to tech jobs', async () => {
    mockFetchSequence([{ ok: true, json: fixture }]);

    const result = await parse({
      appId: 'app-id',
      appKey: 'app-key',
      countries: ['us'],
      maxPages: 1,
      resultsPerPage: 50,
    });

    expect(result.jobs.length).toBe(1);
    const job = result.jobs[0]!;
    expect(job.sourceId).toBe('adzuna');
    expect(job.externalId).toBe('adzuna:us:123');
    expect(job.company).toBe('Acme');
    expect(job.isRemote).toBe(true);
  });

  it('requires credentials in parse config', async () => {
    await expect(parse({ countries: ['us'] })).rejects.toThrow('Adzuna parser requires appId and appKey');
  });

  it('retries on 500 and succeeds on next attempt', async () => {
    const fetchMock = mockFetchSequence([
      { ok: false, status: 500 },
      { ok: true, json: fixture },
    ]);

    const result = await parse({
      appId: 'app-id',
      appKey: 'app-key',
      countries: ['us'],
      maxPages: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.jobs.length).toBe(1);
  });

  it('returns jobs compatible with RawJob schema', async () => {
    mockFetchSequence([{ ok: true, json: fixture }]);

    const result = await parse({
      appId: 'app-id',
      appKey: 'app-key',
      countries: ['us'],
      maxPages: 1,
    });

    for (const job of result.jobs) {
      const parsed = rawJobSchema.safeParse(job);
      if (!parsed.success) {
        expect.fail(`Job "${job.title}" failed schema validation: ${JSON.stringify(parsed.error.issues)}`);
      }
    }
  });
});
