import { createHash } from 'node:crypto';
import type { Database } from '@opencruit/db';
import { jobs } from '@opencruit/db';
import { sql } from 'drizzle-orm';
import type { DedupOutcome } from './types.js';

export interface StoreResult {
  plannedInserts: number;
  plannedUpdates: number;
  upserted: number;
}

/**
 * Compute a SHA-256 hash of content fields for change detection.
 * Used to skip updates when nothing has changed.
 */
export function computeContentHash(title: string, description: string, salaryMin?: number | null, salaryMax?: number | null): string {
  const input = [title, description, String(salaryMin ?? ''), String(salaryMax ?? '')].join('|');
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Compute next_check_at based on job age (refresh policy).
 * <2d: 12h, 2-14d: 24h, 14-30d: 72h, >30d: 7d
 */
export function computeNextCheckAt(postedAt: Date | null | undefined): Date {
  const now = Date.now();
  const ageMs = postedAt ? now - postedAt.getTime() : 0;
  const ageHours = ageMs / (1000 * 60 * 60);

  let intervalHours: number;
  if (ageHours < 48) {
    intervalHours = 12;
  } else if (ageHours < 14 * 24) {
    intervalHours = 24;
  } else if (ageHours < 30 * 24) {
    intervalHours = 72;
  } else {
    intervalHours = 7 * 24;
  }

  return new Date(now + intervalHours * 60 * 60 * 1000);
}

/**
 * Store dedup outcomes to the database.
 * 'insert' and 'update' outcomes are upserted via ON CONFLICT DO UPDATE.
 * 'skip' outcomes are ignored.
 */
export async function store(outcomes: DedupOutcome[], db: Database): Promise<StoreResult> {
  const toUpsert = outcomes.filter((o) => o.action === 'insert' || o.action === 'update');

  if (toUpsert.length === 0) {
    return { plannedInserts: 0, plannedUpdates: 0, upserted: 0 };
  }

  // Defensive dedup: avoid multiple rows for same source+external in a single statement.
  const uniqueToUpsert: typeof toUpsert = [];
  const seenSourceExternal = new Set<string>();
  for (const outcome of toUpsert) {
    const key = `${outcome.job.job.sourceId}:${outcome.job.job.externalId}`;
    if (seenSourceExternal.has(key)) continue;
    seenSourceExternal.add(key);
    uniqueToUpsert.push(outcome);
  }

  const now = new Date();
  const rows = uniqueToUpsert.map((o) => {
    const { job: normalizedJob } = o.job;
    return {
      sourceId: normalizedJob.sourceId,
      externalId: normalizedJob.externalId,
      url: normalizedJob.url,
      title: normalizedJob.title,
      company: normalizedJob.company,
      companyLogoUrl: normalizedJob.companyLogoUrl ?? null,
      location: normalizedJob.location ?? null,
      isRemote: normalizedJob.isRemote ?? false,
      description: normalizedJob.description,
      tags: normalizedJob.tags ?? null,
      salaryMin: normalizedJob.salary?.min ?? null,
      salaryMax: normalizedJob.salary?.max ?? null,
      salaryCurrency: normalizedJob.salary?.currency ?? null,
      postedAt: normalizedJob.postedAt ?? null,
      applyUrl: normalizedJob.applyUrl ?? null,
      fingerprint: o.job.fingerprint,
      raw: normalizedJob.raw ?? null,
      status: 'active' as const,
      contentHash: computeContentHash(normalizedJob.title, normalizedJob.description, normalizedJob.salary?.min, normalizedJob.salary?.max),
      lastCheckedAt: now,
      nextCheckAt: computeNextCheckAt(normalizedJob.postedAt),
      lastSeenAt: now,
    };
  });

  await db
    .insert(jobs)
    .values(rows)
    .onConflictDoUpdate({
      target: [jobs.sourceId, jobs.externalId],
      set: {
        title: sql.raw(`excluded.title`),
        company: sql.raw(`excluded.company`),
        companyLogoUrl: sql.raw(`excluded.company_logo_url`),
        location: sql.raw(`excluded.location`),
        isRemote: sql.raw(`excluded.is_remote`),
        description: sql.raw(`excluded.description`),
        tags: sql.raw(`excluded.tags`),
        salaryMin: sql.raw(`excluded.salary_min`),
        salaryMax: sql.raw(`excluded.salary_max`),
        salaryCurrency: sql.raw(`excluded.salary_currency`),
        postedAt: sql.raw(`excluded.posted_at`),
        applyUrl: sql.raw(`excluded.apply_url`),
        fingerprint: sql.raw(`excluded.fingerprint`),
        raw: sql.raw(`excluded.raw`),
        status: sql.raw(`excluded.status`),
        contentHash: sql.raw(`excluded.content_hash`),
        lastCheckedAt: sql.raw(`excluded.last_checked_at`),
        nextCheckAt: sql.raw(`excluded.next_check_at`),
        lastSeenAt: sql.raw(`excluded.last_seen_at`),
        updatedAt: sql`now()`,
      },
    });

  return {
    plannedInserts: uniqueToUpsert.filter((o) => o.action === 'insert').length,
    plannedUpdates: uniqueToUpsert.filter((o) => o.action === 'update').length,
    upserted: rows.length,
  };
}
