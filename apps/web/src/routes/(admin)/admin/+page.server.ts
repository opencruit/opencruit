import type { PageServerLoad } from './$types';
import { jobs, sourceHealth } from '@opencruit/db';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import { getAllQueues, type QueueName } from '$lib/server/queues.js';
import { KNOWN_SOURCES } from '$lib/sources.js';

const QUEUE_STATES = ['wait', 'active', 'delayed', 'completed', 'failed', 'paused'] as const;

export const load: PageServerLoad = async () => {
  const [overviewRows, healthRows, queueHealth] = await Promise.all([
    db.execute(sql`
      select
        count(*) filter (where ${jobs.status} = 'active')::int as "activeTotal",
        count(*) filter (where ${jobs.status} = 'archived')::int as "archivedTotal",
        count(*) filter (where ${jobs.status} = 'missing')::int as "missingTotal",
        count(*) filter (where ${jobs.firstSeenAt} >= now() - interval '24 hours')::int as "newLast24h"
      from ${jobs}
    `),
    db.select().from(sourceHealth),
    collectQueueHealth(),
  ]);

  const overview = overviewRows[0] as Record<string, unknown>;

  const healthySourceIds = new Set<string>();
  const failingSourceIds = new Set<string>();
  for (const row of healthRows) {
    if (row.status === 'failing') {
      failingSourceIds.add(row.sourceId);
    } else {
      healthySourceIds.add(row.sourceId);
    }
  }
  for (const id of failingSourceIds) {
    healthySourceIds.delete(id);
  }

  const sourceHealthSummary = KNOWN_SOURCES.map((source) => {
    const rows = healthRows.filter((r) => r.sourceId === source.id);
    const ingestRow = rows.find((r) => r.stage === 'ingest') ?? rows[0];
    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      status: failingSourceIds.has(source.id) ? 'failing' : rows.length > 0 ? 'healthy' : 'unknown',
      lastRunAt: ingestRow?.lastRunAt?.toISOString() ?? null,
      consecutiveFailures: ingestRow?.consecutiveFailures ?? 0,
      lastDurationMs: ingestRow?.lastDurationMs ?? null,
    };
  });

  return {
    overview: {
      activeTotal: toInt(overview?.activeTotal),
      archivedTotal: toInt(overview?.archivedTotal),
      missingTotal: toInt(overview?.missingTotal),
      newLast24h: toInt(overview?.newLast24h),
    },
    healthySources: healthySourceIds.size,
    failingSources: failingSourceIds.size,
    sourceHealthSummary,
    queueHealth,
  };
};

function toInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return 0;
}

async function collectQueueHealth(): Promise<
  Array<{ name: QueueName; label: string; counts: Record<string, number> }> | null
> {
  const queues = getAllQueues();
  if (!queues) return null;

  const results: Array<{ name: QueueName; label: string; counts: Record<string, number> }> = [];

  const queueLabels: Record<QueueName, string> = {
    'source.ingest': 'Source Ingest',
    'hh.index': 'HH Index',
    'hh.hydrate': 'HH Hydrate',
    'hh.refresh': 'HH Refresh',
    'source.gc': 'Source GC',
  };

  for (const { name, queue } of queues) {
    const counts = (await queue.getJobCounts(...QUEUE_STATES)) as Record<string, number>;
    results.push({ name, label: queueLabels[name], counts });
  }

  return results;
}
