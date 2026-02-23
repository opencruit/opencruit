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

describe('Remotive parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parsing', () => {
    beforeEach(() => {
      mockFetchSequence([{ ok: true, json: { jobs: fixture, 'job-count': fixture.length, 'total-job-count': fixture.length } }]);
    });

    it('parses jobs from API response', async () => {
      const result = await parse();
      const validFixtures = fixture.filter((f: Record<string, string>) => f.title && f.company_name);
      expect(result.jobs.length).toBe(validFixtures.length);
    });

    it('maps fields correctly', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.sourceId).toBe('remotive');
      expect(job.externalId).toMatch(/^remotive:/);
      expect(job.title).toBe(fixture[0]!.title);
      expect(job.company).toBe(fixture[0]!.company_name);
      expect(job.isRemote).toBe(true);
      expect(job.url).toBeTruthy();
      expect(job.description).toBeTruthy();
    });

    it('includes tags', async () => {
      const result = await parse();
      const jobWithTags = result.jobs.find((j) => j.tags && j.tags.length > 0);

      expect(jobWithTags).toBeDefined();
      expect(jobWithTags!.tags!.length).toBeGreaterThan(0);
    });
  });

  describe('salary parsing', () => {
    it('parses salary range string', async () => {
      const jobWithSalary = { ...fixture[0]!, salary: '$120,000 - $170,000' };
      mockFetchSequence([{ ok: true, json: { jobs: [jobWithSalary] } }]);

      const result = await parse();
      expect(result.jobs[0]!.salary).toEqual({
        min: 120_000,
        max: 170_000,
        currency: 'USD',
      });
    });

    it('returns undefined for empty salary', async () => {
      const jobNoSalary = { ...fixture[0]!, salary: '' };
      mockFetchSequence([{ ok: true, json: { jobs: [jobNoSalary] } }]);

      const result = await parse();
      expect(result.jobs[0]!.salary).toBeUndefined();
    });
  });

  describe('schema validation', () => {
    beforeEach(() => {
      mockFetchSequence([{ ok: true, json: { jobs: fixture } }]);
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
      await expect(parse()).rejects.toThrow('Remotive API returned 500');
    });

    it('throws immediately on API 400 without retries', async () => {
      const fetchMock = mockFetchSequence([{ ok: false, status: 400 }]);
      await expect(parse()).rejects.toThrow('Remotive API returned 400');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns empty jobs for empty response', async () => {
      mockFetchSequence([{ ok: true, json: { jobs: [] } }]);
      const result = await parse();
      expect(result.jobs).toEqual([]);
    });
  });
});
