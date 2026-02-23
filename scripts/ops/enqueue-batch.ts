import { createRedisConnection } from '../../apps/worker/src/redis.ts';
import { createQueues } from '../../apps/worker/src/queues.ts';

const DEFAULT_SOURCES = ['remoteok', 'weworkremotely', 'remotive', 'arbeitnow', 'jobicy', 'himalayas'] as const;

async function main(): Promise<void> {
  const requestedSources = process.argv.slice(2);
  const sources = requestedSources.length > 0 ? requestedSources : [...DEFAULT_SOURCES];
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  const redis = createRedisConnection(redisUrl);
  const queues = createQueues(redis);

  try {
    for (const sourceId of sources) {
      const traceId = `manual-${sourceId}-${Date.now()}`;
      const jobId = `manual-source-ingest-${sourceId}-${Date.now()}`;

      await queues.sourceIngestQueue.add(
        'source-ingest',
        {
          sourceId,
          traceId,
        },
        {
          jobId,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );

      console.log(`queued source.ingest for ${sourceId}`);
    }
  } finally {
    await Promise.all([
      queues.sourceIngestQueue.close(),
      queues.indexQueue.close(),
      queues.hydrateQueue.close(),
      queues.refreshQueue.close(),
      queues.sourceGcQueue.close(),
    ]);
    await redis.quit();
  }

  console.log('manual source.ingest enqueue complete');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
