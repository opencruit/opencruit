import { jobs, sourceHealth, type Database } from '@opencruit/db';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from 'pino';
import type { Queues } from '../queues.js';

const METRICS_PATH = '/metrics';
const HEALTH_PATH = '/healthz';
const CONTENT_TYPE_PROMETHEUS = 'text/plain; version=0.0.4; charset=utf-8';
const CONTENT_TYPE_TEXT = 'text/plain; charset=utf-8';
const WORKER_BOOT_TIME_SECONDS = Math.floor(Date.now() / 1000);
const QUEUE_STATES = ['wait', 'active', 'delayed', 'completed', 'failed', 'paused'] as const;

type QueueState = (typeof QUEUE_STATES)[number];
type QueueLike = Pick<Queue, 'name' | 'getJobCounts'>;

interface QueueMetricsRow {
  queue: string;
  state: QueueState;
  value: number;
}

interface SourceHealthRow {
  sourceId: string;
  stage: string;
  status: string;
  consecutiveFailures: number;
  lastDurationMs: number | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
}

interface PmJobsByStatusRow {
  sourceId: string;
  status: string;
  count: unknown;
}

interface PmJobsNewLast24hRow {
  sourceId: string;
  count: unknown;
}

interface PmJobsSnapshot {
  byStatus: PmJobsByStatusRow[];
  newLast24h: PmJobsNewLast24hRow[];
  overview: {
    activeTotal: number;
    archivedTotal: number;
    missingTotal: number;
    remoteActiveTotal: number;
    salaryKnownActiveTotal: number;
    locationKnownActiveTotal: number;
    activeAvgAgeHours: number;
  };
}

export interface MetricsSnapshotOptions {
  db: Database;
  queues: Queues;
  sourceHealthEnabled: boolean;
}

export interface MetricsServerOptions extends MetricsSnapshotOptions {
  host: string;
  port: number;
  logger: Logger;
}

export interface MetricsServerHandle {
  close: () => Promise<void>;
}

function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function renderLabels(labels?: Record<string, string>): string {
  if (!labels) {
    return '';
  }

  const keys = Object.keys(labels);
  if (keys.length === 0) {
    return '';
  }

  const serialized = keys.map((key) => `${key}="${escapeLabelValue(labels[key] ?? '')}"`).join(',');
  return `{${serialized}}`;
}

function renderSample(name: string, value: number, labels?: Record<string, string>): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${name}${renderLabels(labels)} ${safeValue}`;
}

function toUnixSeconds(date: Date | null): number | null {
  if (!date) {
    return null;
  }

  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }

  return Math.floor(ms / 1000);
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (value instanceof Date) {
    const parsed = value.getTime();
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }

  return {};
}

function toQueueEntries(queues: Queues): Array<{ queue: string; client: QueueLike }> {
  return [
    {
      queue: queues.sourceIngestQueue.name,
      client: queues.sourceIngestQueue,
    },
    {
      queue: queues.indexQueue.name,
      client: queues.indexQueue,
    },
    {
      queue: queues.hydrateQueue.name,
      client: queues.hydrateQueue,
    },
    {
      queue: queues.refreshQueue.name,
      client: queues.refreshQueue,
    },
    {
      queue: queues.sourceGcQueue.name,
      client: queues.sourceGcQueue,
    },
  ];
}

async function collectQueueMetrics(queues: Queues): Promise<QueueMetricsRow[]> {
  const rows: QueueMetricsRow[] = [];

  for (const entry of toQueueEntries(queues)) {
    const counts = (await entry.client.getJobCounts(...QUEUE_STATES)) as Record<string, number | undefined>;

    for (const state of QUEUE_STATES) {
      const raw = counts[state] ?? 0;
      rows.push({
        queue: entry.queue,
        state,
        value: Number.isFinite(raw) ? Math.max(0, raw) : 0,
      });
    }
  }

  return rows;
}

async function collectSourceHealthRows(db: Database): Promise<SourceHealthRow[]> {
  const rows = await db.select().from(sourceHealth);

  return rows.map((row) => ({
    sourceId: row.sourceId,
    stage: row.stage,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    lastDurationMs: row.lastDurationMs,
    lastRunAt: row.lastRunAt,
    lastSuccessAt: row.lastSuccessAt,
    lastErrorAt: row.lastErrorAt,
  }));
}

async function collectPmJobsSnapshot(db: Database): Promise<PmJobsSnapshot> {
  const byStatusRaw = await db.execute(sql`
    select
      ${jobs.sourceId} as "sourceId",
      ${jobs.status} as "status",
      count(*)::int as "count"
    from ${jobs}
    group by ${jobs.sourceId}, ${jobs.status}
  `);
  const byStatusRows: PmJobsByStatusRow[] = byStatusRaw
    .map((row) => {
      const record = toRecord(row);
      return {
        sourceId: String(record.sourceId ?? ''),
        status: String(record.status ?? ''),
        count: record.count,
      };
    })
    .filter((row) => row.sourceId.length > 0 && row.status.length > 0);

  const newLast24hRaw = await db.execute(sql`
    select
      ${jobs.sourceId} as "sourceId",
      count(*)::int as "count"
    from ${jobs}
    where ${jobs.firstSeenAt} >= now() - interval '24 hours'
    group by ${jobs.sourceId}
  `);
  const newLast24hRows: PmJobsNewLast24hRow[] = newLast24hRaw
    .map((row) => {
      const record = toRecord(row);
      return {
        sourceId: String(record.sourceId ?? ''),
        count: record.count,
      };
    })
    .filter((row) => row.sourceId.length > 0);

  const overviewRows = await db.execute(sql`
    select
      count(*) filter (where ${jobs.status} = 'active')::int as "activeTotal",
      count(*) filter (where ${jobs.status} = 'archived')::int as "archivedTotal",
      count(*) filter (where ${jobs.status} = 'missing')::int as "missingTotal",
      count(*) filter (where ${jobs.status} = 'active' and ${jobs.isRemote} = true)::int as "remoteActiveTotal",
      count(*) filter (
        where ${jobs.status} = 'active' and (${jobs.salaryMin} is not null or ${jobs.salaryMax} is not null)
      )::int as "salaryKnownActiveTotal",
      count(*) filter (
        where ${jobs.status} = 'active' and ${jobs.location} is not null and btrim(${jobs.location}) <> ''
      )::int as "locationKnownActiveTotal",
      avg(extract(epoch from (now() - ${jobs.postedAt})) / 3600.0) filter (
        where ${jobs.status} = 'active' and ${jobs.postedAt} is not null
      ) as "activeAvgAgeHours"
    from ${jobs}
  `);
  const overview = toRecord(overviewRows[0]);

  return {
    byStatus: byStatusRows,
    newLast24h: newLast24hRows,
    overview: {
      activeTotal: Math.max(0, Math.floor(toFiniteNumber(overview?.activeTotal))),
      archivedTotal: Math.max(0, Math.floor(toFiniteNumber(overview?.archivedTotal))),
      missingTotal: Math.max(0, Math.floor(toFiniteNumber(overview?.missingTotal))),
      remoteActiveTotal: Math.max(0, Math.floor(toFiniteNumber(overview?.remoteActiveTotal))),
      salaryKnownActiveTotal: Math.max(0, Math.floor(toFiniteNumber(overview?.salaryKnownActiveTotal))),
      locationKnownActiveTotal: Math.max(0, Math.floor(toFiniteNumber(overview?.locationKnownActiveTotal))),
      activeAvgAgeHours: Math.max(0, toFiniteNumber(overview?.activeAvgAgeHours)),
    },
  };
}

export async function buildPrometheusMetrics(options: MetricsSnapshotOptions): Promise<string> {
  const queueRows = await collectQueueMetrics(options.queues);
  const pmJobsSnapshot = await collectPmJobsSnapshot(options.db);

  const lines: string[] = [];

  lines.push('# HELP opencruit_worker_up Whether the worker process is running.');
  lines.push('# TYPE opencruit_worker_up gauge');
  lines.push(renderSample('opencruit_worker_up', 1));

  lines.push('# HELP opencruit_worker_uptime_seconds Worker process uptime in seconds.');
  lines.push('# TYPE opencruit_worker_uptime_seconds gauge');
  lines.push(renderSample('opencruit_worker_uptime_seconds', process.uptime()));

  lines.push('# HELP opencruit_worker_boot_time_seconds Worker process start time as unix timestamp.');
  lines.push('# TYPE opencruit_worker_boot_time_seconds gauge');
  lines.push(renderSample('opencruit_worker_boot_time_seconds', WORKER_BOOT_TIME_SECONDS));

  lines.push('# HELP opencruit_queue_jobs Jobs currently visible in each BullMQ queue state.');
  lines.push('# TYPE opencruit_queue_jobs gauge');
  for (const row of queueRows) {
    lines.push(
      renderSample('opencruit_queue_jobs', row.value, {
        queue: row.queue,
        state: row.state,
      }),
    );
  }

  lines.push('# HELP opencruit_pm_jobs_total Total jobs by source and lifecycle status.');
  lines.push('# TYPE opencruit_pm_jobs_total gauge');
  for (const row of pmJobsSnapshot.byStatus) {
    lines.push(
      renderSample('opencruit_pm_jobs_total', Math.max(0, Math.floor(toFiniteNumber(row.count))), {
        source_id: row.sourceId,
        status: row.status,
      }),
    );
  }

  lines.push('# HELP opencruit_pm_jobs_new_last_24h_total Jobs first seen in the last 24h by source.');
  lines.push('# TYPE opencruit_pm_jobs_new_last_24h_total gauge');
  for (const row of pmJobsSnapshot.newLast24h) {
    lines.push(
      renderSample('opencruit_pm_jobs_new_last_24h_total', Math.max(0, Math.floor(toFiniteNumber(row.count))), {
        source_id: row.sourceId,
      }),
    );
  }

  const newLast24hAll = pmJobsSnapshot.newLast24h.reduce((sum, row) => sum + Math.max(0, toFiniteNumber(row.count)), 0);
  const activeTotal = pmJobsSnapshot.overview.activeTotal;
  const archivedTotal = pmJobsSnapshot.overview.archivedTotal;
  const missingTotal = pmJobsSnapshot.overview.missingTotal;
  const remoteActiveTotal = pmJobsSnapshot.overview.remoteActiveTotal;
  const salaryCoverageRatio = activeTotal > 0 ? pmJobsSnapshot.overview.salaryKnownActiveTotal / activeTotal : 0;
  const locationCoverageRatio = activeTotal > 0 ? pmJobsSnapshot.overview.locationKnownActiveTotal / activeTotal : 0;

  lines.push('# HELP opencruit_pm_jobs_new_last_24h_all Total jobs first seen in the last 24h.');
  lines.push('# TYPE opencruit_pm_jobs_new_last_24h_all gauge');
  lines.push(renderSample('opencruit_pm_jobs_new_last_24h_all', newLast24hAll));

  lines.push('# HELP opencruit_pm_jobs_active_total Total active jobs currently visible.');
  lines.push('# TYPE opencruit_pm_jobs_active_total gauge');
  lines.push(renderSample('opencruit_pm_jobs_active_total', activeTotal));

  lines.push('# HELP opencruit_pm_jobs_archived_total Total archived jobs currently visible.');
  lines.push('# TYPE opencruit_pm_jobs_archived_total gauge');
  lines.push(renderSample('opencruit_pm_jobs_archived_total', archivedTotal));

  lines.push('# HELP opencruit_pm_jobs_missing_total Total missing jobs currently visible.');
  lines.push('# TYPE opencruit_pm_jobs_missing_total gauge');
  lines.push(renderSample('opencruit_pm_jobs_missing_total', missingTotal));

  lines.push('# HELP opencruit_pm_jobs_remote_active_total Total active jobs marked as remote.');
  lines.push('# TYPE opencruit_pm_jobs_remote_active_total gauge');
  lines.push(renderSample('opencruit_pm_jobs_remote_active_total', remoteActiveTotal));

  lines.push('# HELP opencruit_pm_jobs_salary_coverage_ratio Share of active jobs with salary data (0..1).');
  lines.push('# TYPE opencruit_pm_jobs_salary_coverage_ratio gauge');
  lines.push(renderSample('opencruit_pm_jobs_salary_coverage_ratio', salaryCoverageRatio));

  lines.push('# HELP opencruit_pm_jobs_location_coverage_ratio Share of active jobs with location data (0..1).');
  lines.push('# TYPE opencruit_pm_jobs_location_coverage_ratio gauge');
  lines.push(renderSample('opencruit_pm_jobs_location_coverage_ratio', locationCoverageRatio));

  lines.push('# HELP opencruit_pm_jobs_active_avg_age_hours Average age of active jobs by posted_at in hours.');
  lines.push('# TYPE opencruit_pm_jobs_active_avg_age_hours gauge');
  lines.push(renderSample('opencruit_pm_jobs_active_avg_age_hours', pmJobsSnapshot.overview.activeAvgAgeHours));

  if (options.sourceHealthEnabled) {
    const sourceHealthRows = await collectSourceHealthRows(options.db);
    let failingStages = 0;

    lines.push('# HELP opencruit_source_health_status Source stage health status (healthy=1, failing=1).');
    lines.push('# TYPE opencruit_source_health_status gauge');

    lines.push('# HELP opencruit_source_consecutive_failures Consecutive failure count per source stage.');
    lines.push('# TYPE opencruit_source_consecutive_failures gauge');

    lines.push('# HELP opencruit_source_last_duration_ms Last observed duration per source stage in ms.');
    lines.push('# TYPE opencruit_source_last_duration_ms gauge');

    lines.push('# HELP opencruit_source_last_run_timestamp_seconds Last run timestamp per source stage.');
    lines.push('# TYPE opencruit_source_last_run_timestamp_seconds gauge');

    lines.push('# HELP opencruit_source_last_success_timestamp_seconds Last success timestamp per source stage.');
    lines.push('# TYPE opencruit_source_last_success_timestamp_seconds gauge');

    lines.push('# HELP opencruit_source_last_error_timestamp_seconds Last error timestamp per source stage.');
    lines.push('# TYPE opencruit_source_last_error_timestamp_seconds gauge');

    for (const row of sourceHealthRows) {
      const status = row.status;
      if (status === 'failing') {
        failingStages += 1;
      }

      lines.push(
        renderSample('opencruit_source_health_status', 1, {
          source_id: row.sourceId,
          stage: row.stage,
          status,
        }),
      );
      lines.push(
        renderSample('opencruit_source_consecutive_failures', Math.max(0, row.consecutiveFailures), {
          source_id: row.sourceId,
          stage: row.stage,
        }),
      );

      if (row.lastDurationMs !== null) {
        lines.push(
          renderSample('opencruit_source_last_duration_ms', Math.max(0, row.lastDurationMs), {
            source_id: row.sourceId,
            stage: row.stage,
          }),
        );
      }

      const runTs = toUnixSeconds(row.lastRunAt);
      if (runTs !== null) {
        lines.push(
          renderSample('opencruit_source_last_run_timestamp_seconds', runTs, {
            source_id: row.sourceId,
            stage: row.stage,
          }),
        );
      }

      const successTs = toUnixSeconds(row.lastSuccessAt);
      if (successTs !== null) {
        lines.push(
          renderSample('opencruit_source_last_success_timestamp_seconds', successTs, {
            source_id: row.sourceId,
            stage: row.stage,
          }),
        );
      }

      const errorTs = toUnixSeconds(row.lastErrorAt);
      if (errorTs !== null) {
        lines.push(
          renderSample('opencruit_source_last_error_timestamp_seconds', errorTs, {
            source_id: row.sourceId,
            stage: row.stage,
          }),
        );
      }
    }

    lines.push('# HELP opencruit_source_health_rows_total Number of source_health rows currently available.');
    lines.push('# TYPE opencruit_source_health_rows_total gauge');
    lines.push(renderSample('opencruit_source_health_rows_total', sourceHealthRows.length));

    lines.push('# HELP opencruit_source_health_failing_total Number of source stages currently failing.');
    lines.push('# TYPE opencruit_source_health_failing_total gauge');
    lines.push(renderSample('opencruit_source_health_failing_total', failingStages));
  }

  return `${lines.join('\n')}\n`;
}

function resolvePath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function writeText(response: ServerResponse, statusCode: number, contentType: string, body: string): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', contentType);
  response.end(body);
}

export function startMetricsServer(options: MetricsServerOptions): MetricsServerHandle {
  const server = createServer((request, response) => {
    void (async () => {
      const path = resolvePath(request);

      if (path === HEALTH_PATH) {
        writeText(response, 200, CONTENT_TYPE_TEXT, 'ok\n');
        return;
      }

      if (path !== METRICS_PATH) {
        writeText(response, 404, CONTENT_TYPE_TEXT, 'not found\n');
        return;
      }

      try {
        const body = await buildPrometheusMetrics(options);
        writeText(response, 200, CONTENT_TYPE_PROMETHEUS, body);
      } catch (error) {
        options.logger.warn(
          {
            event: 'worker_metrics_scrape_failed',
            error,
          },
          'Failed to build worker metrics snapshot',
        );
        writeText(response, 500, CONTENT_TYPE_TEXT, 'metrics unavailable\n');
      }
    })();
  });

  server.listen(options.port, options.host, () => {
    const address = server.address() as AddressInfo | null;
    options.logger.info(
      {
        event: 'worker_metrics_server_started',
        host: options.host,
        port: address?.port ?? options.port,
        path: METRICS_PATH,
      },
      'Worker metrics server started',
    );
  });

  return {
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}
