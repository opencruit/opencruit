import { sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { jobs, type Database } from '@opencruit/db';
import type { SourceGcJobData } from '../queues.js';
import { getSourceGcPolicy, listKnownGcPolicySources } from './source-gc-policy.js';

export interface SourceGcJobDeps {
  db: Database;
}

export interface SourceGcResult {
  archived: number;
  deleted: number;
  processedSources: number;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

async function resolveSourceIds(db: Database, explicitSourceId?: string): Promise<string[]> {
  if (explicitSourceId) {
    return [explicitSourceId];
  }

  const rows = await db.selectDistinct({ sourceId: jobs.sourceId }).from(jobs);
  const unique = new Set<string>(listKnownGcPolicySources());

  for (const row of rows) {
    if (row.sourceId) {
      unique.add(row.sourceId);
    }
  }

  return [...unique];
}

async function archiveStaleJobsForSource(db: Database, sourceId: string): Promise<number> {
  const policy = getSourceGcPolicy(sourceId);
  const now = new Date();
  const staleBefore = subDays(now, policy.archiveAfterDays);
  const nextCheckAt = addDays(now, policy.archivedRecheckDays);

  const archived = await db
    .update(jobs)
    .set({
      status: 'archived',
      lastCheckedAt: now,
      nextCheckAt,
      updatedAt: now,
    })
    .where(
      sql`${jobs.sourceId} = ${sourceId} and ${jobs.status} = 'active' and coalesce(${jobs.lastSeenAt}, ${jobs.updatedAt}) < ${staleBefore}`,
    )
    .returning({ id: jobs.id });

  return archived.length;
}

async function deleteExpiredJobsForSource(db: Database, sourceId: string): Promise<number> {
  const policy = getSourceGcPolicy(sourceId);
  const cutoff = subDays(new Date(), policy.deleteAfterDays);

  const deleted = await db
    .delete(jobs)
    .where(
      sql`${jobs.sourceId} = ${sourceId} and ${jobs.status} in ('archived', 'missing') and coalesce(${jobs.lastCheckedAt}, ${jobs.updatedAt}) < ${cutoff}`,
    )
    .returning({ id: jobs.id });

  return deleted.length;
}

export async function handleSourceGcJob(job: Job<SourceGcJobData>, deps: SourceGcJobDeps): Promise<SourceGcResult> {
  const sourceIds = await resolveSourceIds(deps.db, job.data.sourceId);
  if (sourceIds.length === 0) {
    return {
      archived: 0,
      deleted: 0,
      processedSources: 0,
    };
  }

  if (job.data.mode === 'archive') {
    let archived = 0;
    for (const sourceId of sourceIds) {
      archived += await archiveStaleJobsForSource(deps.db, sourceId);
    }

    return {
      archived,
      deleted: 0,
      processedSources: sourceIds.length,
    };
  }

  let deleted = 0;
  for (const sourceId of sourceIds) {
    deleted += await deleteExpiredJobsForSource(deps.db, sourceId);
  }

  return {
    archived: 0,
    deleted,
    processedSources: sourceIds.length,
  };
}
