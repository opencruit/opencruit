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

describe('Jobicy parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parsing', () => {
    beforeEach(() => {
      mockFetchSequence([{ ok: true, json: { jobs: fixture, jobCount: fixture.length, success: true } }]);
    });

    it('parses jobs from API response', async () => {
      const result = await parse();
      const validFixtures = fixture.filter((f: Record<string, string>) => f.jobTitle && f.companyName);
      expect(result.jobs.length).toBe(validFixtures.length);
    });

    it('maps fields correctly', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.sourceId).toBe('jobicy');
      expect(job.externalId).toMatch(/^jobicy:/);
      expect(job.title).toBe(fixture[0]!.jobTitle);
      expect(job.company).toBe(fixture[0]!.companyName);
      expect(job.isRemote).toBe(true);
      expect(job.url).toBeTruthy();
      expect(job.description).toBeTruthy();
    });
  });

  describe('schema validation', () => {
    beforeEach(() => {
      mockFetchSequence([{ ok: true, json: { jobs: fixture, jobCount: fixture.length, success: true } }]);
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
      await expect(parse()).rejects.toThrow('Jobicy API returned 500');
    });

    it('throws immediately on API 400 without retries', async () => {
      const fetchMock = mockFetchSequence([{ ok: false, status: 400 }]);
      await expect(parse()).rejects.toThrow('Jobicy API returned 400');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws when API success flag is false', async () => {
      mockFetchSequence([{ ok: true, json: { jobs: fixture, jobCount: fixture.length, success: false } }]);
      await expect(parse()).rejects.toThrow('Jobicy API returned unsuccessful response');
    });

    it('returns empty jobs for empty response', async () => {
      mockFetchSequence([{ ok: true, json: { jobs: [], jobCount: 0, success: true } }]);
      const result = await parse();
      expect(result.jobs).toEqual([]);
    });
  });
});
