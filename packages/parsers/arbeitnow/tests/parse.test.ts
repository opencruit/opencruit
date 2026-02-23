import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('Arbeitnow parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parsing', () => {
    beforeEach(() => {
      mockFetchSequence([{ ok: true, json: { data: fixture } }]);
    });

    it('parses jobs from API response', async () => {
      const result = await parse();
      const validFixtures = fixture.filter((f: Record<string, string>) => f.title && f.company_name);
      expect(result.jobs.length).toBe(validFixtures.length);
    });

    it('maps fields correctly', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.sourceId).toBe('arbeitnow');
      expect(job.externalId).toMatch(/^arbeitnow:/);
      expect(job.title).toBe(fixture[0]!.title);
      expect(job.company).toBe(fixture[0]!.company_name);
      expect(job.url).toBeTruthy();
      expect(job.description).toBeTruthy();
    });

    it('sets isRemote from remote field', async () => {
      const result = await parse();
      const remoteJob = result.jobs.find((j) => (j.raw as Record<string, boolean>).remote === true);

      if (remoteJob) {
        expect(remoteJob.isRemote).toBe(true);
      }
    });

    it('follows pagination and merges jobs from multiple pages', async () => {
      const page1 = fixture.map((job: Record<string, unknown>, idx: number) => ({
        ...job,
        slug: `page-1-${idx}`,
      }));
      const page2 = fixture.map((job: Record<string, unknown>, idx: number) => ({
        ...job,
        slug: `page-2-${idx}`,
      }));

      const fetchMock = mockFetchSequence([
        { ok: true, json: { data: page1, meta: { per_page: page1.length } } },
        { ok: true, json: { data: page2, meta: { per_page: page2.length } } },
        { ok: true, json: { data: [], meta: { per_page: page2.length } } },
      ]);

      const result = await parse();
      expect(result.jobs.length).toBe(page1.length + page2.length);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('returns partial results when later pages hit rate limit', async () => {
      const fetchMock = mockFetchSequence([
        { ok: true, json: { data: fixture, meta: { per_page: fixture.length } } },
        { ok: false, status: 429 },
      ]);

      const result = await parse();
      expect(result.jobs.length).toBe(fixture.length);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('schema validation', () => {
    beforeEach(() => {
      mockFetchSequence([{ ok: true, json: { data: fixture } }]);
    });

    it('every job passes RawJob zod schema', async () => {
      const result = await parse();

      for (const job of result.jobs) {
        const parsed = rawJobSchema.safeParse(job);
        if (!parsed.success) {
          expect.fail(`Job "${job.title}" failed schema validation: ${JSON.stringify(parsed.error.issues)}`);
        }
      }
    });
  });

  describe('error handling', () => {
    it('throws on API 500', async () => {
      mockFetchSequence([{ ok: false, status: 500 }]);
      await expect(parse()).rejects.toThrow('Arbeitnow API returned 500');
    });

    it('throws immediately on API 404 without retries', async () => {
      const fetchMock = mockFetchSequence([{ ok: false, status: 404 }]);

      await expect(parse()).rejects.toThrow('Arbeitnow API returned 404');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns empty jobs for empty response', async () => {
      mockFetchSequence([{ ok: true, json: { data: [] } }]);
      const result = await parse();
      expect(result.jobs).toEqual([]);
    });
  });
});
