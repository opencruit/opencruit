import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse } from '../src/index.js';
import { rawJobSchema } from '@opencruit/parser-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(__dirname, '../fixtures/feed.xml'), 'utf-8');

function mockFetch(response: { ok: boolean; status?: number; text?: string }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      text: () => Promise.resolve(response.text),
    }),
  );
}

describe('WeWorkRemotely parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('parsing', () => {
    beforeEach(() => {
      mockFetch({ ok: true, text: fixture });
    });

    it('parses jobs from RSS feed', async () => {
      const result = await parse();
      expect(result.jobs.length).toBe(5);
    });

    it('maps fields correctly', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.sourceId).toBe('weworkremotely');
      expect(job.externalId).toMatch(/^weworkremotely:/);
      expect(job.isRemote).toBe(true);
      expect(job.url).toBeTruthy();
      expect(job.description).toBeTruthy();
    });

    it('extracts company from title', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      // First fixture item: "Summedd: Full Stack Engineer with AI Coding expertise for SaaS Platform"
      expect(job.company).toBe('Summedd');
      expect(job.title).toBe('Full Stack Engineer with AI Coding expertise for SaaS Platform');
    });

    it('extracts slug for externalId', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.externalId).toBe(
        'weworkremotely:summedd-full-stack-engineer-with-ai-coding-expertise-for-saas-platform',
      );
    });

    it('parses tags from skills', async () => {
      const result = await parse();
      // Third fixture item (Ottimate) has skills
      const jobWithSkills = result.jobs.find((j) => j.tags && j.tags.length > 2);

      expect(jobWithSkills).toBeDefined();
      expect(jobWithSkills!.tags!).toContain('Analytics');
    });

    it('includes category in tags', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.tags).toContain('Full-Stack Programming');
    });

    it('handles logo URL from media:content', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.companyLogoUrl).toBe('https://wwr-pro.s3.amazonaws.com/logos/0171/4199/logo.gif');
    });

    it('parses location from region', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.location).toBe('Anywhere in the World');
    });

    it('parses pubDate', async () => {
      const result = await parse();
      const job = result.jobs[0]!;

      expect(job.postedAt).toBeInstanceOf(Date);
      expect(job.postedAt!.getFullYear()).toBeGreaterThanOrEqual(2025);
    });
  });

  describe('schema validation', () => {
    beforeEach(() => {
      mockFetch({ ok: true, text: fixture });
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
    it('throws on HTTP 500', async () => {
      mockFetch({ ok: false, status: 500 });
      await expect(parse()).rejects.toThrow('WeWorkRemotely RSS returned 500');
    });

    it('returns empty jobs for empty feed', async () => {
      const emptyFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>WWR</title></channel></rss>`;
      mockFetch({ ok: true, text: emptyFeed });
      const result = await parse();
      expect(result.jobs).toEqual([]);
    });

    it('handles single item feed', async () => {
      const singleItem = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss">
  <channel>
    <title>WWR</title>
    <item>
      <media:content url="https://example.com/logo.png" type="image/png"/>
      <title>TestCo: Test Job</title>
      <link>https://weworkremotely.com/remote-jobs/testco-test-job</link>
      <guid>https://weworkremotely.com/remote-jobs/testco-test-job</guid>
      <description>Job description here</description>
      <pubDate>Mon, 01 Jan 2026 00:00:00 +0000</pubDate>
      <region>Remote</region>
      <category>Programming</category>
    </item>
  </channel>
</rss>`;
      mockFetch({ ok: true, text: singleItem });
      const result = await parse();
      expect(result.jobs.length).toBe(1);
      expect(result.jobs[0]!.company).toBe('TestCo');
    });
  });
});
