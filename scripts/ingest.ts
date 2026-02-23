import { createHash } from 'node:crypto';
import { remoteOKParser } from '@opencruit/parser-remoteok';
import { weWorkRemotelyParser } from '@opencruit/parser-weworkremotely';
import { validateRawJobs } from '@opencruit/parser-sdk';
import type { Parser } from '@opencruit/parser-sdk';
import { createDatabase, jobs } from '@opencruit/db';
import { sql } from 'drizzle-orm';

const db = createDatabase(process.env.DATABASE_URL!);

const parsers: Parser[] = [remoteOKParser, weWorkRemotelyParser];

function fingerprint(company: string, title: string, location?: string): string {
  const input = [company, title, location ?? ''].map((s) => s.toLowerCase().trim()).join('|');
  return createHash('sha256').update(input).digest('hex');
}

async function ingestParser(parser: Parser): Promise<number> {
  const { id, name } = parser.manifest;
  console.log(`[ingest:${id}] Fetching jobs from ${name}...`);

  const result = await parser.parse();
  console.log(`[ingest:${id}] Received ${result.jobs.length} jobs`);

  const validated = validateRawJobs(result.jobs);
  console.log(`[ingest:${id}] ${validated.length} jobs passed validation`);

  if (validated.length === 0) {
    console.log(`[ingest:${id}] Nothing to insert`);
    return 0;
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

  console.log(`[ingest:${id}] Upserting into database...`);

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

  console.log(`[ingest:${id}] ${upserted.length} jobs upserted.`);
  return upserted.length;
}

async function ingest() {
  let total = 0;
  const errors: Array<{ id: string; error: unknown }> = [];

  for (const parser of parsers) {
    try {
      total += await ingestParser(parser);
    } catch (err) {
      console.error(`[ingest:${parser.manifest.id}] Error:`, err);
      errors.push({ id: parser.manifest.id, error: err });
    }
  }

  console.log(`[ingest] Done. ${total} total jobs upserted across ${parsers.length} parsers.`);

  if (errors.length > 0) {
    console.error(`[ingest] ${errors.length} parser(s) failed: ${errors.map((e) => e.id).join(', ')}`);
    process.exit(1);
  }

  process.exit(0);
}

ingest().catch((err) => {
  console.error('[ingest] Fatal error:', err);
  process.exit(1);
});
