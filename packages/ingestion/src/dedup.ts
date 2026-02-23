import type { Database } from '@opencruit/db';
import { jobs } from '@opencruit/db';
import { asc, inArray } from 'drizzle-orm';
import type { FingerprintedJob, DedupOutcome } from './types.js';

/**
 * Tier 2 dedup: check fingerprints against DB before insert.
 *
 * - Fingerprint exists from DIFFERENT source → skip (first source wins)
 * - Fingerprint exists from SAME source → update (re-scrape, Tier 1 handles via upsert)
 * - Fingerprint not found → insert
 */
export async function dedup(
  fingerprintedJobs: FingerprintedJob[],
  db: Database,
): Promise<DedupOutcome[]> {
  if (fingerprintedJobs.length === 0) return [];

  // Collect unique fingerprints for batch query
  const fingerprints = [...new Set(fingerprintedJobs.map((fj) => fj.fingerprint))];

  // Single query: find all existing jobs with these fingerprints
  const existing = await db
    .select({
      fingerprint: jobs.fingerprint,
      sourceId: jobs.sourceId,
      id: jobs.id,
    })
    .from(jobs)
    .where(inArray(jobs.fingerprint, fingerprints))
    .orderBy(asc(jobs.createdAt), asc(jobs.id));

  // Build lookup: fingerprint → [{ sourceId, id }]
  const existingByFingerprint = new Map<string, Array<{ sourceId: string; id: string }>>();
  for (const row of existing) {
    const list = existingByFingerprint.get(row.fingerprint) ?? [];
    list.push({ sourceId: row.sourceId, id: row.id });
    existingByFingerprint.set(row.fingerprint, list);
  }

  // Classify each job
  const outcomes: DedupOutcome[] = [];
  const seenSourceExternal = new Set<string>();
  const seenFingerprintInBatch = new Map<string, string>();

  for (const fj of fingerprintedJobs) {
    const sourceExternalKey = `${fj.job.sourceId}:${fj.job.externalId}`;
    if (seenSourceExternal.has(sourceExternalKey)) {
      outcomes.push({
        action: 'skip',
        job: fj,
        reason: `duplicate source/external in batch: ${sourceExternalKey}`,
      });
      continue;
    }
    seenSourceExternal.add(sourceExternalKey);

    const batchSourceForFingerprint = seenFingerprintInBatch.get(fj.fingerprint);
    if (batchSourceForFingerprint) {
      outcomes.push({
        action: 'skip',
        job: fj,
        reason: `fingerprint duplicate in batch of ${batchSourceForFingerprint}`,
      });
      continue;
    }

    const matches = existingByFingerprint.get(fj.fingerprint);

    if (!matches || matches.length === 0) {
      seenFingerprintInBatch.set(fj.fingerprint, fj.job.sourceId);
      outcomes.push({ action: 'insert', job: fj });
      continue;
    }

    const winning = matches[0]!;
    if (winning.sourceId !== fj.job.sourceId) {
      outcomes.push({
        action: 'skip',
        job: fj,
        reason: `fingerprint duplicate of ${winning.sourceId}:${winning.id}`,
      });
    } else {
      seenFingerprintInBatch.set(fj.fingerprint, fj.job.sourceId);
      outcomes.push({ action: 'update', job: fj, existingId: winning.id });
    }
  }

  return outcomes;
}
