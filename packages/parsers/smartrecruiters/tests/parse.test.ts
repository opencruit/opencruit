import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from '../src/index.js';
import { rawJobSchema } from '@opencruit/parser-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const listFixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/list-response.json'), 'utf-8'));
const detailFixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/detail-response.json'), 'utf-8'));

describe('SmartRecruiters parser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses list + detail and filters to tech jobs', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/postings?')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(listFixture),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(detailFixture),
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await parse({
      companies: ['demo'],
      maxPages: 1,
      limit: 100,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.jobs.length).toBe(1);
    const job = result.jobs[0]!;
    expect(job.sourceId).toBe('smartrecruiters');
    expect(job.externalId).toBe('smartrecruiters:demo:3001');
    expect(job.company).toBe('demo');
    expect(job.description).toContain('Build scalable data pipelines');
  });

  it('returns empty list on unknown company (404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      }),
    );

    const result = await parse({
      companies: ['missing-company'],
      maxPages: 1,
    });

    expect(result.jobs).toEqual([]);
  });

  it('requires companies in parse config', async () => {
    await expect(parse({ companies: [] })).rejects.toThrow('SmartRecruiters parser requires at least one company identifier');
  });

  it('returns jobs compatible with RawJob schema', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/postings?')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(listFixture),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(detailFixture),
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await parse({
      companies: ['demo'],
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
