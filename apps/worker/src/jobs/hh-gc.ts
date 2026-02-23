import { and, eq, lt, sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { jobs, type Database } from '@opencruit/db';
import type { HhGcJobData } from '../queues.js';

const SOURCE_ID = 'hh';
const ARCHIVE_AFTER_DAYS = 4;
const ARCHIVED_RECHECK_DAYS = 30;
const DELETE_AFTER_DAYS = 30;

export interface HhGcJobDeps {
  db: Database;
}

export interface HhGcResult {
  archived: number;
  deleted: number;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

async function archiveStaleJobs(db: Database): Promise<number> {
  const now = new Date();
  const staleBefore = subDays(now, ARCHIVE_AFTER_DAYS);
  const nextCheckAt = addDays(now, ARCHIVED_RECHECK_DAYS);

  const updated = await db
    .update(jobs)
    .set({
      status: 'archived',
      lastCheckedAt: now,
      nextCheckAt,
      updatedAt: now,
    })
    .where(and(eq(jobs.sourceId, SOURCE_ID), eq(jobs.status, 'active'), lt(jobs.lastSeenAt, staleBefore)))
    .returning({ id: jobs.id });

  return updated.length;
}

async function deleteExpiredArchivedJobs(db: Database): Promise<number> {
  const cutoff = subDays(new Date(), DELETE_AFTER_DAYS);

  const deleted = await db
    .delete(jobs)
    .where(
      sql`${jobs.sourceId} = ${SOURCE_ID} and ${jobs.status} in ('archived', 'missing') and coalesce(${jobs.lastCheckedAt}, ${jobs.updatedAt}) < ${cutoff}`,
    )
    .returning({ id: jobs.id });

  return deleted.length;
}

export async function handleHhGcJob(job: Job<HhGcJobData>, deps: HhGcJobDeps): Promise<HhGcResult> {
  if (job.data.mode === 'archive') {
    const archived = await archiveStaleJobs(deps.db);
    return {
      archived,
      deleted: 0,
    };
  }

  const deleted = await deleteExpiredArchivedJobs(deps.db);
  return {
    archived: 0,
    deleted,
  };
}
