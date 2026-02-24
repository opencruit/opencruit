import type { PageServerLoad } from './$types';
import { jobs, sourceHealth, sourceCursors } from '@opencruit/db';
import { db } from '$lib/server/db';
import { eq, desc, sql } from 'drizzle-orm';
import { KNOWN_SOURCES } from '$lib/sources.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
  const sourceId = params.id;
  const sourceMeta = KNOWN_SOURCES.find((s) => s.id === sourceId);

  if (!sourceMeta) {
    error(404, `Source "${sourceId}" not found`);
  }

  const [healthRows, cursorRows, jobCountRows, recentJobs] = await Promise.all([
    db.select().from(sourceHealth).where(eq(sourceHealth.sourceId, sourceId)),
    db.select().from(sourceCursors).where(eq(sourceCursors.source, sourceId)),
    db.execute(sql`
      select
        ${jobs.status} as "status",
        count(*)::int as "count"
      from ${jobs}
      where ${jobs.sourceId} = ${sourceId}
      group by ${jobs.status}
    `),
    db
      .select({
        externalId: jobs.externalId,
        title: jobs.title,
        company: jobs.company,
        status: jobs.status,
        firstSeenAt: jobs.firstSeenAt,
      })
      .from(jobs)
      .where(eq(jobs.sourceId, sourceId))
      .orderBy(desc(jobs.firstSeenAt))
      .limit(20),
  ]);

  const stages = healthRows.map((row) => ({
    stage: row.stage,
    status: row.status,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    consecutiveFailures: row.consecutiveFailures,
    lastDurationMs: row.lastDurationMs,
    lastError: row.lastError,
  }));

  const counts: Record<string, number> = {};
  for (const row of jobCountRows) {
    const r = row as Record<string, unknown>;
    counts[String(r['status'] ?? '')] = Number(r['count'] ?? 0);
  }

  const cursors = cursorRows.map((row) => ({
    segmentKey: row.segmentKey,
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
    cursor: row.cursor as Record<string, unknown> | null,
    stats: row.stats as Record<string, unknown> | null,
  }));

  return {
    source: {
      id: sourceMeta.id,
      label: sourceMeta.label,
      kind: sourceMeta.kind,
    },
    stages,
    counts,
    cursors,
    recentJobs: recentJobs.map((j) => ({
      externalId: j.externalId,
      title: j.title,
      company: j.company,
      status: j.status,
      firstSeenAt: j.firstSeenAt.toISOString(),
    })),
  };
};
