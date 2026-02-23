import { createHash } from 'node:crypto';
import type { NormalizedJob, FingerprintedJob } from './types.js';

function canonicalizeLocation(location?: string): string {
  if (!location) return '';
  const normalized = location.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\b(remote|anywhere|worldwide|work from home)\b/.test(normalized)) {
    return 'remote';
  }
  return normalized;
}

/**
 * Compute a SHA-256 fingerprint from company, title, and location.
 * Used for Tier 2 dedup: same job from different sources.
 */
export function computeFingerprint(company: string, title: string, location?: string): string {
  const input = [company.toLowerCase().trim(), title.toLowerCase().trim(), canonicalizeLocation(location)].join('|');
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Add fingerprint to a normalized job.
 */
export function fingerprintJob(job: NormalizedJob): FingerprintedJob {
  return {
    job,
    fingerprint: computeFingerprint(job.company, job.title, job.location),
  };
}

/**
 * Fingerprint a batch of normalized jobs.
 */
export function fingerprintJobs(jobs: NormalizedJob[]): FingerprintedJob[] {
  return jobs.map(fingerprintJob);
}
