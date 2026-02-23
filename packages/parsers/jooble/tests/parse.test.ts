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

describe('Jooble parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses and filters to tech jobs', async () => {
    mockFetchSequence([{ ok: true, json: fixture }]);

    const result = await parse({
      apiKey: 'test-api-key',
      countries: ['de'],
      keywords: ['software engineer'],
      maxPages: 1,
    });

    expect(result.jobs.length).toBe(1);
    const job = result.jobs[0]!;
    expect(job.sourceId).toBe('jooble');
    expect(job.externalId).toBe('jooble:de:j1');
    expect(job.company).toBe('Acme');
    expect(job.salary).toEqual({
      min: 60000,
      max: 80000,
      currency: 'EUR',
    });
  });

  it('requires api key in parse config', async () => {
    await expect(parse({ countries: ['de'] })).rejects.toThrow('Jooble parser requires apiKey');
  });

  it('does not retry on 400', async () => {
    const fetchMock = mockFetchSequence([{ ok: false, status: 400 }]);

    await expect(
      parse({
        apiKey: 'test-api-key',
        countries: ['de'],
      }),
    ).rejects.toThrow('Jooble API returned 400');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns jobs compatible with RawJob schema', async () => {
    mockFetchSequence([{ ok: true, json: fixture }]);

    const result = await parse({
      apiKey: 'test-api-key',
      countries: ['de'],
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
