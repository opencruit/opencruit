import { createHash } from 'node:crypto';
import { parse } from '@opencruit/parser-remoteok';
import { validateRawJobs } from '@opencruit/parser-sdk';
import { createDatabase, jobs } from '@opencruit/db';

const db = createDatabase(process.env.DATABASE_URL!);
import { sql } from 'drizzle-orm';

function fingerprint(company: string, title: string, location?: string): string {
  const input = [company, title, location ?? ''].map((s) => s.toLowerCase().trim()).join('|');
  return createHash('sha256').update(input).digest('hex');
}

async function ingest() {
  console.log('[ingest] Fetching jobs from RemoteOK...');
  const result = await parse();
  console.log(`[ingest] Received ${result.jobs.length} jobs`);

  const validated = validateRawJobs(result.jobs);
  console.log(`[ingest] ${validated.length} jobs passed validation`);

  if (validated.length === 0) {
    console.log('[ingest] Nothing to insert');
    process.exit(0);
  }

  const rows = validated.map((job) => ({
    sourceId: job.sourceId,
    externalId: job.externalId,
    url: job.url,
    title: job.title,
    company: job.company,
    companyLogoUrl: job.companyLogoUrl ?? null,
    location: job.location ?? null,
    isRemote: job.isRemote ?? false,
    description: job.description,
    tags: job.tags ?? null,
    salaryMin: job.salary?.min ?? null,
    salaryMax: job.salary?.max ?? null,
    salaryCurrency: job.salary?.currency ?? null,
    postedAt: job.postedAt ?? null,
    applyUrl: job.applyUrl ?? null,
    fingerprint: fingerprint(job.company, job.title, job.location),
    raw: job.raw ?? null,
  }));

  console.log('[ingest] Upserting into database...');

  const upserted = await db
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
    })
    .returning({ id: jobs.id });

  console.log(`[ingest] Done. ${upserted.length} jobs upserted.`);
  process.exit(0);
}

ingest().catch((err) => {
  console.error('[ingest] Fatal error:', err);
  process.exit(1);
});
