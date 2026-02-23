import type { Database } from '@opencruit/db';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { SourceStage } from '../sources/types.js';
import { withLogger } from './with-logger.js';
import { withSourceHealth } from './with-source-health.js';

interface TraceableData {
  traceId?: string;
}

export interface RunSourceJobOptions<TData extends TraceableData, TResult> {
  db: Database;
  logger: Logger;
  queue: string;
  sourceId?: string;
  stage: SourceStage;
  healthEnabled: boolean;
  job: Job<TData>;
  context?: (traceId: string) => Record<string, unknown>;
  summary?: (result: TResult) => Record<string, unknown>;
  run: () => Promise<TResult>;
}

export async function runSourceJob<TData extends TraceableData, TResult>({
  db,
  logger,
  queue,
  sourceId,
  stage,
  healthEnabled,
  job,
  context,
  summary,
  run,
}: RunSourceJobOptions<TData, TResult>): Promise<TResult> {
  return withSourceHealth({
    db,
    logger,
    sourceId,
    stage,
    enabled: healthEnabled,
    run: () =>
      withLogger({
        logger,
        queue,
        job,
        context,
        summary,
        run,
      }),
  });
}
