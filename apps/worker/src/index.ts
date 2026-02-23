import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { createDatabase, type Database } from '@opencruit/db';
import { HhClient } from '@opencruit/parser-hh';
import { handleBatchIngestJob } from './jobs/batch-ingest.js';
import { handleHhHydrateJob } from './jobs/hh-hydrate.js';
import { handleHhIndexJob } from './jobs/hh-index.js';
import { handleHhRefreshJob } from './jobs/hh-refresh.js';
import { handleSourceGcJob } from './jobs/source-gc.js';
import {
  createQueues,
  type HhHydrateJobData,
  type HhIndexJobData,
  type HhRefreshJobData,
  HH_HYDRATE_QUEUE,
  HH_INDEX_QUEUE,
  HH_REFRESH_QUEUE,
  type Queues,
  SOURCE_GC_QUEUE,
  SOURCE_INGEST_QUEUE,
  type SourceGcJobData,
  type SourceIngestJobData,
} from './queues.js';
import { createRedisConnection } from './redis.js';
import { scheduleAllSources } from './scheduler.js';
import { createWorkerLogger } from './observability/logger.js';
import {
  attachWorkerTelemetry,
  isSourceHealthAvailable,
  type WorkerTelemetryHandle,
  type WorkerTelemetryOptions,
} from './observability/worker-telemetry.js';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const DEFAULT_HH_USER_AGENT = 'OpenCruit (dev@opencruit.dev)';

interface RuntimeState {
  db: Database | null;
  redis: ReturnType<typeof createRedisConnection> | null;
  queues: Queues | null;
  workers: Array<Worker>;
  telemetryHandles: WorkerTelemetryHandle[];
}

const runtimeState: RuntimeState = {
  db: null,
  redis: null,
  queues: null,
  workers: [],
  telemetryHandles: [],
};

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
}

async function closeDbConnection(db: Database | null): Promise<void> {
  if (!db) {
    return;
  }

  await db.$client.end();
}

async function cleanupRuntimeState(state: RuntimeState): Promise<void> {
  await Promise.allSettled(state.workers.map((worker) => worker.close()));
  await Promise.allSettled(state.telemetryHandles.map((handle) => handle.flush()));

  if (state.queues) {
    await Promise.allSettled([
      state.queues.sourceIngestQueue.close(),
      state.queues.indexQueue.close(),
      state.queues.hydrateQueue.close(),
      state.queues.refreshQueue.close(),
      state.queues.sourceGcQueue.close(),
    ]);
  }

  if (state.redis) {
    await Promise.allSettled([state.redis.quit()]);
  }

  await Promise.allSettled([closeDbConnection(state.db)]);
}

async function run(): Promise<void> {
  const logger = createWorkerLogger();
  const databaseUrl = readRequiredEnv('DATABASE_URL');
  const redisUrl = process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
  const hhUserAgent = process.env.HH_USER_AGENT ?? DEFAULT_HH_USER_AGENT;
  const hhBootstrapIndexNow = readBoolEnv('HH_BOOTSTRAP_INDEX_NOW', false);
  const hhHydrateMaxBacklog = readIntEnv('HH_HYDRATE_MAX_BACKLOG', 5000);

  const db = createDatabase(databaseUrl);
  runtimeState.db = db;
  const sourceHealthEnabled = await isSourceHealthAvailable(db);
  if (!sourceHealthEnabled) {
    logger.warn(
      {
        event: 'source_health_disabled',
      },
      'Source health table is unavailable; health persistence disabled',
    );
  }

  const redis = createRedisConnection(redisUrl);
  runtimeState.redis = redis;
  const queues = createQueues(redis);
  runtimeState.queues = queues;
  const workerOptions = {
    connection: redis,
    concurrency: 1,
  } as const;

  const hhClient = new HhClient({
    userAgent: hhUserAgent,
    accessToken: process.env.HH_ACCESS_TOKEN || undefined,
    minDelayMs: readIntEnv('HH_MIN_DELAY_MS', 2000),
    maxDelayMs: readIntEnv('HH_MAX_DELAY_MS', 4000),
    timeoutMs: readIntEnv('HH_TIMEOUT_MS', 15_000),
    maxRetries: readIntEnv('HH_MAX_RETRIES', 3),
    circuitFailureThreshold: readIntEnv('HH_CIRCUIT_FAILURE_THRESHOLD', 5),
    circuitOpenMs: readIntEnv('HH_CIRCUIT_OPEN_MS', 5 * 60 * 1000),
  });

  interface TraceableData {
    traceId?: string;
  }
  const telemetryHandles = runtimeState.telemetryHandles;

  function createObservedWorker<TData extends TraceableData, TResult>(
    queue: string,
    processor: (job: Job<TData>) => Promise<TResult>,
    telemetry: Omit<WorkerTelemetryOptions<TData, TResult>, 'logger' | 'db' | 'queue' | 'healthEnabled'>,
  ): Worker<TData, TResult> {
    const worker = new Worker<TData, TResult>(queue, processor, workerOptions);
    const telemetryHandle = attachWorkerTelemetry(worker, {
      logger,
      db,
      queue,
      healthEnabled: sourceHealthEnabled,
      ...telemetry,
    });
    telemetryHandles.push(telemetryHandle);

    return worker;
  }

  const sourceIngestWorker = createObservedWorker(
    SOURCE_INGEST_QUEUE,
    (job: Job<SourceIngestJobData>) =>
      handleBatchIngestJob(job, {
        db,
        logger,
      }),
    {
      stage: 'ingest',
      resolveSourceId: (job) => job.data.sourceId,
      context: (job) => ({
        sourceId: job.data.sourceId,
      }),
      summary: (_job, result) => ({
        sourceId: result.sourceId,
        jobsReceived: result.stats.received,
        upserted: result.stats.upserted,
        validationDropped: result.stats.validationDropped,
        errorsCount: result.errors.length,
      }),
    },
  );

  const indexWorker = createObservedWorker(
    HH_INDEX_QUEUE,
    (job: Job<HhIndexJobData>) =>
      handleHhIndexJob(job, {
        client: hhClient,
        db,
        hydrateQueue: queues.hydrateQueue,
        indexQueue: queues.indexQueue,
        maxHydrateBacklog: hhHydrateMaxBacklog,
      }),
    {
      stage: 'index',
      resolveSourceId: () => 'hh',
      context: (job) => ({
        sourceId: 'hh',
        professionalRole: job.data.professionalRole,
        depth: job.data.depth ?? 0,
        dateFromIso: job.data.dateFromIso,
        dateToIso: job.data.dateToIso,
      }),
      summary: (_job, result) => ({
        sourceId: 'hh',
        found: result.found,
        pagesFetched: result.pagesFetched,
        enqueued: result.enqueued,
        split: result.split,
        skippedDueToBacklog: result.skippedDueToBacklog ?? false,
        hydrateBacklog: result.hydrateBacklog,
        backlogLimit: result.backlogLimit,
      }),
    },
  );

  const hydrateWorker = createObservedWorker(
    HH_HYDRATE_QUEUE,
    (job: Job<HhHydrateJobData>) =>
      handleHhHydrateJob(job, {
        client: hhClient,
        db,
        logger,
      }),
    {
      stage: 'hydrate',
      resolveSourceId: () => 'hh',
      context: (job) => ({
        sourceId: 'hh',
        vacancyId: job.data.vacancyId,
        reason: job.data.reason,
      }),
      summary: (_job, result) => ({
        sourceId: 'hh',
        status: result.status,
        upserted: result.upserted,
        skippedContentWrite: result.skippedContentWrite,
      }),
    },
  );

  const refreshWorker = createObservedWorker(
    HH_REFRESH_QUEUE,
    (job: Job<HhRefreshJobData>) =>
      handleHhRefreshJob(job, {
        db,
        hydrateQueue: queues.hydrateQueue,
      }),
    {
      stage: 'refresh',
      resolveSourceId: () => 'hh',
      context: (job) => ({
        sourceId: 'hh',
        batchSize: job.data.batchSize,
      }),
      summary: (_job, result) => ({
        sourceId: 'hh',
        selected: result.selected,
        enqueued: result.enqueued,
      }),
    },
  );

  const gcWorker = createObservedWorker(
    SOURCE_GC_QUEUE,
    (job: Job<SourceGcJobData>) =>
      handleSourceGcJob(job, {
        db,
      }),
    {
      stage: 'gc',
      resolveSourceId: (job) => job.data.sourceId,
      context: (job) => ({
        mode: job.data.mode,
        sourceId: job.data.sourceId,
      }),
      summary: (_job, result) => ({
        archived: result.archived,
        deleted: result.deleted,
        processedSources: result.processedSources,
      }),
    },
  );

  const workers = [sourceIngestWorker, indexWorker, hydrateWorker, refreshWorker, gcWorker];
  runtimeState.workers.push(...workers);

  for (const worker of workers) {
    worker.on('error', (error) => {
      logger.error(
        {
          event: 'worker_runtime_error',
          queue: worker.name,
          error,
        },
        'Worker runtime error',
      );
    });
  }

  const schedulerResult = await scheduleAllSources(queues, hhClient, {
    bootstrapIndexNow: hhBootstrapIndexNow,
  });
  if (schedulerResult.workflowErrors.length === 0 && schedulerResult.batchErrors.length === 0) {
    logger.info(
      {
        event: 'scheduler_configured',
        scheduledBatchSources: schedulerResult.scheduledBatchSources,
        scheduledWorkflowSources: schedulerResult.scheduledWorkflowSources,
        disabledSources: schedulerResult.disabledSources,
        workflowStats: schedulerResult.workflowStats,
        hhBootstrapIndexNow,
        hhHydrateMaxBacklog,
      },
      'Scheduler configured',
    );
  } else {
    logger.warn(
      {
        event: 'scheduler_partially_configured',
        scheduledBatchSources: schedulerResult.scheduledBatchSources,
        scheduledWorkflowSources: schedulerResult.scheduledWorkflowSources,
        disabledSources: schedulerResult.disabledSources,
        batchErrors: schedulerResult.batchErrors,
        workflowErrors: schedulerResult.workflowErrors,
        workflowStats: schedulerResult.workflowStats,
        hhBootstrapIndexNow,
        hhHydrateMaxBacklog,
      },
      'Scheduler partially configured: source scheduling failed',
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info(
      {
        event: 'shutdown_requested',
        signal,
      },
      'Shutdown requested',
    );

    await cleanupRuntimeState(runtimeState);

    logger.info(
      {
        event: 'shutdown_completed',
        signal,
      },
      'Shutdown completed',
    );

    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  logger.info(
    {
      event: 'worker_started',
      redisUrl,
    },
    'Worker started',
  );
}

run().catch(async (error) => {
  await cleanupRuntimeState(runtimeState);
  const logger = createWorkerLogger();
  logger.error(
    {
      event: 'worker_fatal_error',
      error,
    },
    'Worker fatal error',
  );
  process.exit(1);
});
