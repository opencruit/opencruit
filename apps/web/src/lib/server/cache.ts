import type { RawJob } from '@opencruit/parser-sdk';

interface CacheEntry {
  jobs: RawJob[];
  fetchedAt: number;
}

let cached: CacheEntry | null = null;
const TTL_MS = 15 * 60 * 1000; // 15 minutes

export function getCachedJobs(): RawJob[] | null {
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > TTL_MS) {
    cached = null;
    return null;
  }
  return cached.jobs;
}

export function setCachedJobs(jobs: RawJob[]): void {
  cached = { jobs, fetchedAt: Date.now() };
}

export function getCachedJobById(id: string): RawJob | undefined {
  if (!cached) return undefined;
  return cached.jobs.find((j) => j.externalId === id);
}
