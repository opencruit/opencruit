import { and, asc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Job, Queue } from 'bullmq';
import { jobs, type Database } from '@opencruit/db';
import type { HhHydrateJobData, HhRefreshJobData } from '../queues.js';
import { withTrace } from '../observability/with-trace.js';

const SOURCE_ID = 'hh';
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 2000;
const REFRESH_LEASE_HOURS = 2;

export interface HhRefreshJobDeps {
  db: Database;
  hydrateQueue: Queue<HhHydrateJobData>;
}

export interface HhRefreshResult {
  selected: number;
  enqueued: number;
}

function parseVacancyId(externalId: string): string | null {
  const [source, vacancyId] = externalId.split(':', 2);
  if (source !== SOURCE_ID || !vacancyId) {
    return null;
  }

  return vacancyId;
}

function clampBatchSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(Math.max(1, value), MAX_BATCH_SIZE);
}

export async function handleHhRefreshJob(job: Job<HhRefreshJobData>, deps: HhRefreshJobDeps): Promise<HhRefreshResult> {
  const traceId = withTrace(job);
  const now = new Date();
  const batchSize = clampBatchSize(job.data.batchSize);

  const dueJobs = await deps.db
    .select({ externalId: jobs.externalId })
    .from(jobs)
    .where(
      and(
        eq(jobs.sourceId, SOURCE_ID),
        eq(jobs.status, 'active'),
        isNotNull(jobs.nextCheckAt),
        lte(jobs.nextCheckAt, now),
      ),
    )
    .orderBy(asc(jobs.nextCheckAt))
    .limit(batchSize);

  if (dueJobs.length === 0) {
    return { selected: 0, enqueued: 0 };
  }

  const leaseUntil = new Date(now.getTime() + REFRESH_LEASE_HOURS * 60 * 60 * 1000);
  const externalIds = dueJobs.map((row) => row.externalId);

  await deps.db
    .update(jobs)
    .set({
      nextCheckAt: leaseUntil,
      updatedAt: now,
    })
    .where(and(eq(jobs.sourceId, SOURCE_ID), inArray(jobs.externalId, externalIds)));

  let enqueued = 0;
  for (const row of dueJobs) {
    const vacancyId = parseVacancyId(row.externalId);
    if (!vacancyId) {
      continue;
    }

    await deps.hydrateQueue.add(
      'hh-hydrate',
      {
        vacancyId,
        reason: 'refresh',
        traceId,
      },
      {
        jobId: `hh-hydrate-refresh-${vacancyId}`,
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );

    enqueued += 1;
  }

  return {
    selected: dueJobs.length,
    enqueued,
  };
}
