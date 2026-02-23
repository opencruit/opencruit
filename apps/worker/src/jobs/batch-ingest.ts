import type { Job } from 'bullmq';
import type { Database } from '@opencruit/db';
import { ingestBatch, type BatchIngestionResult } from '@opencruit/ingestion';
import type { Logger } from 'pino';
import type { SourceIngestJobData } from '../queues.js';
import { getSourceById } from '../sources/catalog.js';
import { createIngestionLogger } from '../observability/ingestion-logger.js';

export interface BatchIngestJobDeps {
  db: Database;
  logger: Logger;
}

export async function handleBatchIngestJob(
  job: Job<SourceIngestJobData>,
  deps: BatchIngestJobDeps,
): Promise<BatchIngestionResult> {
  const source = getSourceById(job.data.sourceId);
  if (source.kind !== 'batch') {
    throw new Error(`Source ${source.id} is not a batch source`);
  }

  const parser = source.parser;
  const parsed = await parser.parse();
  const ingestionLogger = createIngestionLogger(
    deps.logger.child({
      queue: 'source.ingest',
      sourceId: source.id,
      traceId: job.data.traceId,
    }),
  );

  const result = await ingestBatch(parsed.jobs, deps.db, {
    sourceId: source.id,
    logger: ingestionLogger,
  });

  if (result.errors.length > 0) {
    throw new Error(`[source.ingest:${source.id}] ${result.errors.join(' | ')}`);
  }

  return result;
}
