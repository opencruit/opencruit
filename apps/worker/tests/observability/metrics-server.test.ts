import type { Database } from '@opencruit/db';
import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { Queues } from '../../src/queues.js';
import { buildPrometheusMetrics } from '../../src/observability/metrics-server.js';
import { stub } from '../test-helpers.js';

function createQueue(name: string, counts: Record<string, number>): Pick<Queue, 'name' | 'getJobCounts'> {
  return stub<Pick<Queue, 'name' | 'getJobCounts'>>({
    name,
    getJobCounts: vi.fn().mockResolvedValue(counts),
  });
}

function createQueuesStub(): Queues {
  return stub<Queues>({
    sourceIngestQueue: createQueue('source.ingest', {
      wait: 3,
      active: 1,
      delayed: 2,
      completed: 40,
      failed: 4,
      paused: 0,
    }),
    indexQueue: createQueue('hh.index', {
      wait: 1,
      active: 0,
      delayed: 0,
      completed: 7,
      failed: 1,
      paused: 0,
    }),
    hydrateQueue: createQueue('hh.hydrate', {
      wait: 5,
      active: 2,
      delayed: 1,
      completed: 100,
      failed: 3,
      paused: 0,
    }),
    refreshQueue: createQueue('hh.refresh', {
      wait: 0,
      active: 0,
      delayed: 0,
      completed: 11,
      failed: 0,
      paused: 0,
    }),
    sourceGcQueue: createQueue('source.gc', {
      wait: 0,
      active: 0,
      delayed: 0,
      completed: 5,
      failed: 0,
      paused: 0,
    }),
  });
}

interface DbStubInput {
  sourceHealthRows: unknown[];
  jobsByStatusRows?: unknown[];
  jobsNewLast24hRows?: unknown[];
  jobsOverviewRows?: unknown[];
}

function createDbStub(input: DbStubInput): Database {
  const from = vi.fn().mockResolvedValue(input.sourceHealthRows);
  const select = vi.fn().mockReturnValue({ from });
  const execute = vi
    .fn()
    .mockResolvedValueOnce(input.jobsByStatusRows ?? [])
    .mockResolvedValueOnce(input.jobsNewLast24hRows ?? [])
    .mockResolvedValueOnce(
      input.jobsOverviewRows ?? [
        {
          activeTotal: 0,
          archivedTotal: 0,
          missingTotal: 0,
          remoteActiveTotal: 0,
          salaryKnownActiveTotal: 0,
          locationKnownActiveTotal: 0,
          activeAvgAgeHours: 0,
        },
      ],
    );

  return stub<Database>({
    select,
    execute,
  });
}

describe('metrics server', () => {
  it('builds prometheus output with queue and source health metrics', async () => {
    const metrics = await buildPrometheusMetrics({
      db: createDbStub({
        sourceHealthRows: [
          {
            sourceId: 'remoteok',
            stage: 'ingest',
            status: 'healthy',
            consecutiveFailures: 0,
            lastDurationMs: 1234,
            lastRunAt: new Date('2026-01-01T00:00:00.000Z'),
            lastSuccessAt: new Date('2026-01-01T00:00:00.000Z'),
            lastErrorAt: null,
          },
          {
            sourceId: 'hh',
            stage: 'hydrate',
            status: 'failing',
            consecutiveFailures: 3,
            lastDurationMs: 456,
            lastRunAt: new Date('2026-01-01T01:00:00.000Z'),
            lastSuccessAt: null,
            lastErrorAt: new Date('2026-01-01T01:00:00.000Z'),
          },
        ],
        jobsByStatusRows: [
          { sourceId: 'remoteok', status: 'active', count: 20 },
          { sourceId: 'weworkremotely', status: 'active', count: 10 },
          { sourceId: 'remoteok', status: 'archived', count: 5 },
        ],
        jobsNewLast24hRows: [
          { sourceId: 'remoteok', count: 4 },
          { sourceId: 'weworkremotely', count: 2 },
        ],
        jobsOverviewRows: [
          {
            activeTotal: 30,
            archivedTotal: 5,
            missingTotal: 1,
            remoteActiveTotal: 18,
            salaryKnownActiveTotal: 12,
            locationKnownActiveTotal: 24,
            activeAvgAgeHours: 36.5,
          },
        ],
      }),
      queues: createQueuesStub(),
      sourceHealthEnabled: true,
    });

    expect(metrics).toContain('# HELP opencruit_worker_up Whether the worker process is running.');
    expect(metrics).toContain('opencruit_worker_up 1');
    expect(metrics).toContain('opencruit_queue_jobs{queue="source.ingest",state="wait"} 3');
    expect(metrics).toContain('opencruit_queue_jobs{queue="hh.hydrate",state="active"} 2');
    expect(metrics).toContain('opencruit_pm_jobs_total{source_id="remoteok",status="active"} 20');
    expect(metrics).toContain('opencruit_pm_jobs_new_last_24h_total{source_id="remoteok"} 4');
    expect(metrics).toContain('opencruit_pm_jobs_new_last_24h_all 6');
    expect(metrics).toContain('opencruit_pm_jobs_active_total 30');
    expect(metrics).toContain('opencruit_pm_jobs_salary_coverage_ratio 0.4');
    expect(metrics).toContain('opencruit_pm_jobs_location_coverage_ratio 0.8');
    expect(metrics).toContain('opencruit_pm_jobs_active_avg_age_hours 36.5');
    expect(metrics).toContain('opencruit_source_health_status{source_id="remoteok",stage="ingest",status="healthy"} 1');
    expect(metrics).toContain('opencruit_source_health_status{source_id="hh",stage="hydrate",status="failing"} 1');
    expect(metrics).toContain('opencruit_source_health_rows_total 2');
    expect(metrics).toContain('opencruit_source_health_failing_total 1');
  });

  it('omits source health metrics when table integration is disabled', async () => {
    const metrics = await buildPrometheusMetrics({
      db: createDbStub({
        sourceHealthRows: [],
        jobsByStatusRows: [{ sourceId: 'remoteok', status: 'active', count: 3 }],
        jobsNewLast24hRows: [{ sourceId: 'remoteok', count: 1 }],
        jobsOverviewRows: [
          {
            activeTotal: 3,
            archivedTotal: 0,
            missingTotal: 0,
            remoteActiveTotal: 2,
            salaryKnownActiveTotal: 1,
            locationKnownActiveTotal: 3,
            activeAvgAgeHours: 12,
          },
        ],
      }),
      queues: createQueuesStub(),
      sourceHealthEnabled: false,
    });

    expect(metrics).toContain('opencruit_queue_jobs{queue="source.ingest",state="wait"} 3');
    expect(metrics).toContain('opencruit_pm_jobs_total{source_id="remoteok",status="active"} 3');
    expect(metrics).not.toContain('opencruit_source_health_status');
    expect(metrics).not.toContain('opencruit_source_health_failing_total');
  });
});
