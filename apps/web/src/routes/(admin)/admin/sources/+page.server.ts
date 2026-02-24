import type { Actions, PageServerLoad } from './$types';
import { jobs, sourceHealth } from '@opencruit/db';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import { getQueue, type SourceIngestJobData } from '$lib/server/queues.js';
import { KNOWN_SOURCES } from '$lib/sources.js';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
  const [healthRows, jobCountRows] = await Promise.all([
    db.select().from(sourceHealth),
    db.execute(sql`
      select
        ${jobs.sourceId} as "sourceId",
        ${jobs.status} as "status",
        count(*)::int as "count"
      from ${jobs}
      group by ${jobs.sourceId}, ${jobs.status}
    `),
  ]);

  const jobCounts = new Map<string, Record<string, number>>();
  for (const row of jobCountRows) {
    const r = row as Record<string, unknown>;
    const sourceId = String(r['sourceId'] ?? '');
    const status = String(r['status'] ?? '');
    const count = Number(r['count'] ?? 0);
    if (!jobCounts.has(sourceId)) jobCounts.set(sourceId, {});
    const entry = jobCounts.get(sourceId)!;
    entry[status] = count;
  }

  const sources = KNOWN_SOURCES.map((source) => {
    const rows = healthRows.filter((r) => r.sourceId === source.id);
    const ingestRow = rows.find((r) => r.stage === 'ingest') ?? rows[0];
    const counts = jobCounts.get(source.id) ?? {};

    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      status: rows.some((r) => r.status === 'failing')
        ? ('failing' as const)
        : rows.length > 0
          ? ('healthy' as const)
          : ('unknown' as const),
      lastRunAt: ingestRow?.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: ingestRow?.lastSuccessAt?.toISOString() ?? null,
      lastErrorAt: ingestRow?.lastErrorAt?.toISOString() ?? null,
      consecutiveFailures: ingestRow?.consecutiveFailures ?? 0,
      lastDurationMs: ingestRow?.lastDurationMs ?? null,
      lastError: ingestRow?.lastError ?? null,
      activeJobs: counts['active'] ?? 0,
      archivedJobs: counts['archived'] ?? 0,
      totalJobs: Object.values(counts).reduce((sum, n) => sum + n, 0),
    };
  });

  return { sources };
};

export const actions: Actions = {
  triggerIngest: async ({ request }) => {
    const formData = await request.formData();
    const sourceId = formData.get('sourceId');

    if (typeof sourceId !== 'string' || !KNOWN_SOURCES.some((s) => s.id === sourceId)) {
      return fail(400, { error: 'Invalid source ID' });
    }

    const queue = getQueue('source.ingest');
    if (!queue) return fail(503, { error: 'Redis not connected' });
    await queue.add(
      `source-ingest-manual-${sourceId}`,
      { sourceId } satisfies SourceIngestJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );

    return { triggered: sourceId };
  },
};
