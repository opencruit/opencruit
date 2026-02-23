import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { parse } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/response.json'), 'utf-8'));

beforeAll(() => {
  // Mock fetch to return fixture data (first element is legal notice in real API)
  const mockResponse = [{ legal: 'notice' }, ...fixture];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }),
  );
});

describe('RemoteOK parser', () => {
  it('parses jobs from API response', async () => {
    const result = await parse();

    expect(result.jobs.length).toBe(fixture.length);
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
