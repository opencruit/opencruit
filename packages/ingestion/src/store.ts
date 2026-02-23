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
        updatedAt: sql`now()`,
      },
    });

  return {
    plannedInserts: uniqueToUpsert.filter((o) => o.action === 'insert').length,
    plannedUpdates: uniqueToUpsert.filter((o) => o.action === 'update').length,
    upserted: rows.length,
  };
}
