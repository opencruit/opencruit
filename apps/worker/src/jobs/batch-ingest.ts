import type { Job } from 'bullmq';
import type { Database } from '@opencruit/db';
import { ingestBatch, type BatchIngestionResult } from '@opencruit/ingestion';
import type { Logger } from 'pino';
import type { SourceIngestJobData } from '../queues.js';
import { getParser } from '../registry.js';
import { createIngestionLogger } from '../observability/ingestion-logger.js';

export interface BatchIngestJobDeps {
  db: Database;
  logger: Logger;
}

export async function handleBatchIngestJob(
  job: Job<SourceIngestJobData>,
  deps: BatchIngestJobDeps,
): Promise<BatchIngestionResult> {
  const parser = getParser(job.data.parserId);
  const parsed = await parser.parse();
  const ingestionLogger = createIngestionLogger(
    deps.logger.child({
      queue: 'source.ingest',
      parserId: parser.manifest.id,
      traceId: job.data.traceId,
    }),
  );

  return ingestBatch(parsed.jobs, deps.db, {
    sourceId: parser.manifest.id,
    logger: ingestionLogger,
  });
}
