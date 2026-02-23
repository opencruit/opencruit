import { and, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { jobs, type Database } from '@opencruit/db';
import { HhClient, HhHttpError, mapVacancyToRawJob } from '@opencruit/parser-hh';
import { computeContentHash, dedup, fingerprintJobs, normalize, store, validate } from '@opencruit/ingestion';
import type { HhHydrateJobData } from '../queues.js';

const SOURCE_ID = 'hh';
const ARCHIVED_NEXT_CHECK_DAYS = 30;

export interface HhHydrateJobDeps {
  client: HhClient;
  db: Database;
}

export interface HhHydrateResult {
  upserted: number;
  status: 'active' | 'archived' | 'missing' | 'invalid';
  skippedContentWrite: boolean;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function computeNextCheckAt(postedAt: Date | null | undefined): Date {
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

    const normalizedJobs = valid.map(normalize);
    const normalized = normalizedJobs[0]!;
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

    const fingerprinted = fingerprintJobs(normalizedJobs);
    const outcomes = await dedup(fingerprinted, deps.db);
    const storeResult = await store(outcomes, deps.db);

    await touchStatus(deps.db, externalId, status, now, nextCheckAt);

    return {
      upserted: storeResult.upserted,
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
