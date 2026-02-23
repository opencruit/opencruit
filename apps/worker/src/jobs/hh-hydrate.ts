import { and, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { jobs, type Database } from '@opencruit/db';
import { HhClient, HhHttpError, mapVacancyToRawJob } from '@opencruit/parser-hh';
import { computeContentHash, computeNextCheckAt, ingestBatch, normalize, validate } from '@opencruit/ingestion';
import type { Logger } from 'pino';
import type { HhHydrateJobData } from '../queues.js';
import { createIngestionLogger } from '../observability/ingestion-logger.js';

const SOURCE_ID = 'hh';
const ARCHIVED_NEXT_CHECK_DAYS = 30;

export interface HhHydrateJobDeps {
  client: HhClient;
  db: Database;
  logger: Logger;
}

export interface HhHydrateResult {
  upserted: number;
  status: 'active' | 'archived' | 'missing' | 'invalid';
  skippedContentWrite: boolean;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function touchStatus(
  db: Database,
  externalId: string,
  status: 'active' | 'archived' | 'missing',
  now: Date,
  nextCheckAt: Date,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status,
      lastCheckedAt: now,
      nextCheckAt,
      lastSeenAt: status === 'missing' ? undefined : now,
      updatedAt: now,
    })
    .where(and(eq(jobs.sourceId, SOURCE_ID), eq(jobs.externalId, externalId)));
}

export async function handleHhHydrateJob(job: Job<HhHydrateJobData>, deps: HhHydrateJobDeps): Promise<HhHydrateResult> {
  const now = new Date();
  const externalId = `${SOURCE_ID}:${job.data.vacancyId}`;
  const ingestionLogger = createIngestionLogger(
    deps.logger.child({
      queue: 'hh.hydrate',
      sourceId: SOURCE_ID,
      vacancyId: job.data.vacancyId,
      traceId: job.data.traceId,
    }),
  );

  try {
    const vacancy = await deps.client.getVacancy(job.data.vacancyId);
    const rawJob = mapVacancyToRawJob(vacancy);
    const { valid } = validate([rawJob]);

    if (valid.length === 0) {
      return {
        upserted: 0,
        status: 'invalid',
        skippedContentWrite: false,
      };
    }

    const normalized = normalize(valid[0]!);
    const nextCheckAt = vacancy.archived ? addDays(now, ARCHIVED_NEXT_CHECK_DAYS) : computeNextCheckAt(normalized.postedAt);
    const status: 'active' | 'archived' = vacancy.archived ? 'archived' : 'active';

    const contentHash = computeContentHash(
      normalized.title,
      normalized.description,
      normalized.salary?.min,
      normalized.salary?.max,
    );

    const existing = await deps.db
      .select({ contentHash: jobs.contentHash })
      .from(jobs)
      .where(and(eq(jobs.sourceId, SOURCE_ID), eq(jobs.externalId, externalId)))
      .limit(1);

    if (existing[0]?.contentHash === contentHash) {
      await touchStatus(deps.db, externalId, status, now, nextCheckAt);
      return {
        upserted: 0,
        status,
        skippedContentWrite: true,
      };
    }

    const ingestResult = await ingestBatch([rawJob], deps.db, {
      sourceId: SOURCE_ID,
      logger: ingestionLogger,
    });
    if (ingestResult.errors.length > 0) {
      throw new Error(`HH ingest failed for vacancy ${job.data.vacancyId}: ${ingestResult.errors[0]}`);
    }

    await touchStatus(deps.db, externalId, status, now, nextCheckAt);

    return {
      upserted: ingestResult.stats.upserted,
      status,
      skippedContentWrite: false,
    };
  } catch (error) {
    if (error instanceof HhHttpError && error.status === 404) {
      await touchStatus(deps.db, externalId, 'missing', now, addDays(now, ARCHIVED_NEXT_CHECK_DAYS));
      return {
        upserted: 0,
        status: 'missing',
        skippedContentWrite: false,
      };
    }

    throw error;
  }
}
