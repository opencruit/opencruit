import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse } from '../src/index.js';
import { rawJobSchema } from '@opencruit/parser-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/response.json'), 'utf-8'));

function mockFetch(response: { ok: boolean; status?: number; json?: unknown }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () => Promise.resolve(response.json),
    }),
  );
}

describe('RemoteOK parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parsing', () => {
    beforeEach(() => {
      mockFetch({ ok: true, json: [{ legal: 'notice' }, ...fixture] });
    });

    it('parses jobs from API response', async () => {
      const result = await parse();
      const validFixtures = fixture.filter((f: Record<string, string>) => f.position && f.company);
      expect(result.jobs.length).toBe(validFixtures.length);
    });

    it('maps fields correctly', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.sourceId).toBe('remoteok');
      expect(job.externalId).toMatch(/^remoteok:/);
      expect(job.title).toBe(fixture[0]!.position);
      expect(job.company).toBe(fixture[0]!.company);
      expect(job.isRemote).toBe(true);
      expect(job.url).toBeTruthy();
      expect(job.description).toBeTruthy();
    });

    it('skips salary when both min and max are 0', async () => {
      const result = await parse();
      const jobWithZeroSalary = result.jobs.find(
        (j) =>
          j.raw &&
          (j.raw as Record<string, number>).salary_min === 0 &&
          (j.raw as Record<string, number>).salary_max === 0,
      );

      if (jobWithZeroSalary) {
        expect(jobWithZeroSalary.salary).toBeUndefined();
      }
    });

    it('includes tags', async () => {
      const result = await parse();
      const jobWithTags = result.jobs.find((j) => j.tags && j.tags.length > 0);

      expect(jobWithTags).toBeDefined();
      expect(jobWithTags!.tags!.length).toBeGreaterThan(0);
    });
  });

  describe('schema validation', () => {
    beforeEach(() => {
      mockFetch({ ok: true, json: [{ legal: 'notice' }, ...fixture] });
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
      mockFetch({ ok: false, status: 500 });
      await expect(parse()).rejects.toThrow('RemoteOK API returned 500');
    });

    it('returns empty jobs for empty array', async () => {
      mockFetch({ ok: true, json: [] });
      const result = await parse();
      expect(result.jobs).toEqual([]);
    });

    it('returns empty jobs when only legal notice present', async () => {
      mockFetch({ ok: true, json: [{ legal: 'notice' }] });
      const result = await parse();
      expect(result.jobs).toEqual([]);
    });
  });
});
