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

describe('Himalayas parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parsing', () => {
    beforeEach(() => {
      mockFetchSequence([
        {
          ok: true,
          json: { jobs: fixture, totalCount: fixture.length, offset: 0, limit: 20 },
        },
      ]);
    });

    it('parses jobs from API response', async () => {
      const result = await parse();
      const validFixtures = fixture.filter((f: Record<string, string>) => f.title && f.companyName);
      expect(result.jobs.length).toBe(validFixtures.length);
    });

    it('maps fields correctly', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.sourceId).toBe('himalayas');
      expect(job.externalId).toMatch(/^himalayas:/);
      expect(job.title).toBe(fixture[0]!.title);
      expect(job.company).toBe(fixture[0]!.companyName);
      expect(job.isRemote).toBe(true);
      expect(job.url).toBeTruthy();
      expect(job.description).toBeTruthy();
    });

    it('maps salary when present', async () => {
      const jobWithSalary = {
        ...fixture[0]!,
        minSalary: 80000,
        maxSalary: 120000,
        currency: 'USD',
      };
      mockFetchSequence([
        {
          ok: true,
          json: { jobs: [jobWithSalary], totalCount: 1, offset: 0, limit: 20 },
        },
      ]);

      const result = await parse();
      expect(result.jobs[0]!.salary).toEqual({
        min: 80000,
        max: 120000,
        currency: 'USD',
      });
    });

    it('returns undefined salary when both null', async () => {
      const jobNoSalary = {
        ...fixture[0]!,
        minSalary: null,
        maxSalary: null,
      };
      mockFetchSequence([
        {
          ok: true,
          json: { jobs: [jobNoSalary], totalCount: 1, offset: 0, limit: 20 },
        },
      ]);

      const result = await parse();
      expect(result.jobs[0]!.salary).toBeUndefined();
    });
  });

  describe('pagination', () => {
    it('fetches multiple pages using API response limit', async () => {
      const page1 = Array.from({ length: 20 }, (_, i) => ({
        ...fixture[0]!,
        guid: `https://himalayas.app/jobs/job-${i}`,
        title: `Job ${i}`,
      }));
      const page2 = [{ ...fixture[0]!, guid: 'https://himalayas.app/jobs/job-20', title: 'Job 20' }];

      const fetchMock = mockFetchSequence([
        {
          ok: true,
          json: {
            jobs: page1,
            totalCount: 21,
            offset: 0,
            limit: 20,
          },
        },
        {
          ok: true,
          json: {
            jobs: page2,
            totalCount: 21,
            offset: 20,
            limit: 20,
          },
        },
      ]);

      const result = await parse();
      expect(result.jobs.length).toBe(21);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('schema validation', () => {
    beforeEach(() => {
      mockFetchSequence([
        {
          ok: true,
          json: { jobs: fixture, totalCount: fixture.length, offset: 0, limit: 20 },
        },
      ]);
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
      await expect(parse()).rejects.toThrow('Himalayas API returned 500');
    });

    it('throws immediately on API 400 without retries', async () => {
      const fetchMock = mockFetchSequence([{ ok: false, status: 400 }]);
      await expect(parse()).rejects.toThrow('Himalayas API returned 400');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns empty jobs for empty response', async () => {
      mockFetchSequence([{ ok: true, json: { jobs: [], totalCount: 0, offset: 0, limit: 20 } }]);
      const result = await parse();
      expect(result.jobs).toEqual([]);
    });
  });
});
