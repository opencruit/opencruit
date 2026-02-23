import { Worker } from 'bullmq';
import { createDatabase } from '@opencruit/db';
import { HhClient } from '@opencruit/parser-hh';
import { handleBatchIngestJob } from './jobs/batch-ingest.js';
import { handleHhHydrateJob } from './jobs/hh-hydrate.js';
import { handleHhIndexJob } from './jobs/hh-index.js';
import { handleHhRefreshJob } from './jobs/hh-refresh.js';
import { handleSourceGcJob } from './jobs/source-gc.js';
import {
  createQueues,
  HH_HYDRATE_QUEUE,
  HH_INDEX_QUEUE,
  HH_REFRESH_QUEUE,
  SOURCE_GC_QUEUE,
  SOURCE_INGEST_QUEUE,
} from './queues.js';
import { createRedisConnection } from './redis.js';
import { scheduleAllSources } from './scheduler.js';
import { createWorkerLogger } from './observability/logger.js';
import { runSourceJob } from './observability/run-source-job.js';
import { checkSourceHealthAvailability } from './observability/with-source-health.js';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const DEFAULT_HH_USER_AGENT = 'OpenCruit (dev@opencruit.dev)';

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

async function run(): Promise<void> {
  const logger = createWorkerLogger();
  const databaseUrl = readRequiredEnv('DATABASE_URL');
  const redisUrl = process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
  const hhUserAgent = process.env.HH_USER_AGENT ?? DEFAULT_HH_USER_AGENT;

  const db = createDatabase(databaseUrl);
  const sourceHealthEnabled = await checkSourceHealthAvailability(db);
  if (!sourceHealthEnabled) {
    logger.warn(
      {
        event: 'source_health_disabled',
      },
      'Source health table is unavailable; health persistence disabled',
    );
  }

  const redis = createRedisConnection(redisUrl);
  const queues = createQueues(redis);

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

  const sourceIngestWorker = new Worker(
    SOURCE_INGEST_QUEUE,
    (job) =>
      runSourceJob({
        db,
        logger,
        queue: SOURCE_INGEST_QUEUE,
        sourceId: job.data.sourceId,
        stage: 'ingest',
        healthEnabled: sourceHealthEnabled,
        job,
        context: () => ({
          sourceId: job.data.sourceId,
        }),
        summary: (result) => ({
          sourceId: result.sourceId,
          jobsReceived: result.stats.received,
          upserted: result.stats.upserted,
          validationDropped: result.stats.validationDropped,
          errorsCount: result.errors.length,
        }),
        run: () =>
          handleBatchIngestJob(job, {
            db,
            logger,
          }),
      }),
    {
      connection: redis,
      concurrency: 1,
    },
  );

  const indexWorker = new Worker(
    HH_INDEX_QUEUE,
    (job) =>
      runSourceJob({
        db,
        logger,
        queue: HH_INDEX_QUEUE,
        sourceId: 'hh',
        stage: 'index',
        healthEnabled: sourceHealthEnabled,
        job,
        context: () => ({
          sourceId: 'hh',
          professionalRole: job.data.professionalRole,
          depth: job.data.depth ?? 0,
          dateFromIso: job.data.dateFromIso,
          dateToIso: job.data.dateToIso,
        }),
        summary: (result) => ({
          sourceId: 'hh',
          found: result.found,
          pagesFetched: result.pagesFetched,
          enqueued: result.enqueued,
          split: result.split,
        }),
        run: () =>
          handleHhIndexJob(job, {
            client: hhClient,
            db,
            hydrateQueue: queues.hydrateQueue,
            indexQueue: queues.indexQueue,
          }),
      }),
    {
      connection: redis,
      concurrency: 1,
    },
  );

  const hydrateWorker = new Worker(
    HH_HYDRATE_QUEUE,
    (job) =>
      runSourceJob({
        db,
        logger,
        queue: HH_HYDRATE_QUEUE,
        sourceId: 'hh',
        stage: 'hydrate',
        healthEnabled: sourceHealthEnabled,
        job,
        context: () => ({
          sourceId: 'hh',
          vacancyId: job.data.vacancyId,
          reason: job.data.reason,
        }),
        summary: (result) => ({
          sourceId: 'hh',
          status: result.status,
          upserted: result.upserted,
          skippedContentWrite: result.skippedContentWrite,
        }),
        run: () =>
          handleHhHydrateJob(job, {
            client: hhClient,
            db,
            logger,
          }),
      }),
    {
      connection: redis,
      concurrency: 1,
    },
  );

  const refreshWorker = new Worker(
    HH_REFRESH_QUEUE,
    (job) =>
      runSourceJob({
        db,
        logger,
        queue: HH_REFRESH_QUEUE,
        sourceId: 'hh',
        stage: 'refresh',
        healthEnabled: sourceHealthEnabled,
        job,
        context: () => ({
          sourceId: 'hh',
          batchSize: job.data.batchSize,
        }),
        summary: (result) => ({
          sourceId: 'hh',
          selected: result.selected,
          enqueued: result.enqueued,
        }),
        run: () =>
          handleHhRefreshJob(job, {
            db,
            hydrateQueue: queues.hydrateQueue,
          }),
      }),
    {
      connection: redis,
      concurrency: 1,
    },
  );

  const gcWorker = new Worker(
    SOURCE_GC_QUEUE,
    (job) =>
      runSourceJob({
        db,
        logger,
        queue: SOURCE_GC_QUEUE,
        sourceId: job.data.sourceId,
        stage: 'gc',
        healthEnabled: sourceHealthEnabled,
        job,
        context: () => ({
          mode: job.data.mode,
          sourceId: job.data.sourceId,
        }),
        summary: (result) => ({
          archived: result.archived,
          deleted: result.deleted,
          processedSources: result.processedSources,
        }),
        run: () =>
          handleSourceGcJob(job, {
            db,
          }),
      }),
    {
      connection: redis,
      concurrency: 1,
    },
  );

  const workers = [sourceIngestWorker, indexWorker, hydrateWorker, refreshWorker, gcWorker];

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

  const schedulerResult = await scheduleAllSources(queues, hhClient);
  if (schedulerResult.workflowErrors.length === 0) {
    logger.info(
      {
        event: 'scheduler_configured',
        scheduledBatchSources: schedulerResult.scheduledBatchSources,
        scheduledWorkflowSources: schedulerResult.scheduledWorkflowSources,
        workflowStats: schedulerResult.workflowStats,
      },
      'Scheduler configured',
    );
  } else {
    logger.warn(
      {
        event: 'scheduler_partially_configured',
        scheduledBatchSources: schedulerResult.scheduledBatchSources,
        scheduledWorkflowSources: schedulerResult.scheduledWorkflowSources,
        workflowErrors: schedulerResult.workflowErrors,
        workflowStats: schedulerResult.workflowStats,
      },
      'Scheduler partially configured: workflow scheduling failed',
    );
  }

  const closeDb = async (): Promise<void> => {
    const client = (db as unknown as { $client?: { end: () => Promise<void> } }).$client;
    if (client) {
      await client.end();
    }
  };

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

    await Promise.allSettled(workers.map((worker) => worker.close()));
    await Promise.allSettled([
      queues.sourceIngestQueue.close(),
      queues.indexQueue.close(),
      queues.hydrateQueue.close(),
      queues.refreshQueue.close(),
      queues.sourceGcQueue.close(),
    ]);
    await Promise.allSettled([redis.quit(), closeDb()]);

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

run().catch((error) => {
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
