import { Worker } from 'bullmq';
import { createDatabase } from '@opencruit/db';
import { HhClient } from '@opencruit/parser-hh';
import { handleHhGcJob } from './jobs/hh-gc.js';
import { handleHhHydrateJob } from './jobs/hh-hydrate.js';
import { handleHhIndexJob } from './jobs/hh-index.js';
import { handleHhRefreshJob } from './jobs/hh-refresh.js';
import { createHhQueues, HH_GC_QUEUE, HH_HYDRATE_QUEUE, HH_INDEX_QUEUE, HH_REFRESH_QUEUE } from './queues.js';
import { createRedisConnection } from './redis.js';
import { scheduleHhJobs } from './scheduler.js';

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
  const databaseUrl = readRequiredEnv('DATABASE_URL');
  const redisUrl = process.env.REDIS_URL ?? DEFAULT_REDIS_URL;
  const hhUserAgent = process.env.HH_USER_AGENT ?? DEFAULT_HH_USER_AGENT;

  const db = createDatabase(databaseUrl);
  const redis = createRedisConnection(redisUrl);
  const queues = createHhQueues(redis);

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

  const indexWorker = new Worker(
    HH_INDEX_QUEUE,
    (job) =>
      handleHhIndexJob(job, {
        client: hhClient,
        db,
        hydrateQueue: queues.hydrateQueue,
        indexQueue: queues.indexQueue,
      }),
    {
      connection: redis,
      concurrency: 1,
    },
  );

  const hydrateWorker = new Worker(
    HH_HYDRATE_QUEUE,
    (job) =>
      handleHhHydrateJob(job, {
        client: hhClient,
        db,
      }),
    {
      connection: redis,
      concurrency: 1,
    },
  );

  const refreshWorker = new Worker(
    HH_REFRESH_QUEUE,
    (job) =>
      handleHhRefreshJob(job, {
        db,
        hydrateQueue: queues.hydrateQueue,
      }),
    {
      connection: redis,
      concurrency: 1,
    },
  );

  const gcWorker = new Worker(
    HH_GC_QUEUE,
    (job) =>
      handleHhGcJob(job, {
        db,
      }),
    {
      connection: redis,
      concurrency: 1,
    },
  );

  const workers = [indexWorker, hydrateWorker, refreshWorker, gcWorker];

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      const jobId = job?.id ?? 'unknown';
      console.error(`[worker:${worker.name}] Job ${jobId} failed:`, error);
    });
  }

  const schedulerResult = await scheduleHhJobs(queues, hhClient);
  console.log(`[worker] scheduler configured (${schedulerResult.roleCount} IT role segments)`);

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
    console.log(`[worker] received ${signal}, shutting down...`);

    await Promise.allSettled(workers.map((worker) => worker.close()));
    await Promise.allSettled([
      queues.indexQueue.close(),
      queues.hydrateQueue.close(),
      queues.refreshQueue.close(),
      queues.gcQueue.close(),
    ]);
    await Promise.allSettled([redis.quit(), closeDb()]);

    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  console.log('[worker] started');
}

run().catch((error) => {
  console.error('[worker] fatal error:', error);
  process.exit(1);
});
