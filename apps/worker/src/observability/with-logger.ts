import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { withTrace } from './with-trace.js';

interface TraceableData {
  traceId?: string;
}

interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

function computeWaitMs(timestamp: number): number | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }

  return Math.max(0, Date.now() - timestamp);
}

export interface WithLoggerOptions<TData extends TraceableData, TResult> {
  logger: Logger;
  queue: string;
  job: Job<TData>;
  context?: (traceId: string) => Record<string, unknown>;
  summary?: (result: TResult) => Record<string, unknown>;
  run: () => Promise<TResult>;
}

export async function withLogger<TData extends TraceableData, TResult>({
  logger,
  queue,
  job,
  context,
  summary,
  run,
}: WithLoggerOptions<TData, TResult>): Promise<TResult> {
  const traceId = withTrace(job);
  const jobId = String(job.id ?? 'unknown');
  const attempt = job.attemptsMade + 1;
  const waitMs = computeWaitMs(job.timestamp);
  const startedAt = Date.now();
  const common = {
    queue,
    jobName: job.name,
    jobId,
    attempt,
    traceId,
    ...(context ? context(traceId) : {}),
  };

  logger.info(
    {
      event: 'job_started',
      ...common,
      waitMs,
    },
    'Job started',
  );

  try {
    const result = await run();
    logger.info(
      {
        event: 'job_completed',
        ...common,
        durationMs: Date.now() - startedAt,
        ...(summary ? summary(result) : {}),
      },
      'Job completed',
    );
    return result;
  } catch (error) {
    logger.error(
      {
        event: 'job_failed',
        ...common,
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      },
      'Job failed',
    );
    throw error;
  }
}
