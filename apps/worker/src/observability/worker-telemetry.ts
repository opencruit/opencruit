import { sourceHealth, type Database } from '@opencruit/db';
import { sql } from 'drizzle-orm';
import type { Job, Worker } from 'bullmq';
import type { Logger } from 'pino';
import type { SourceStage } from '../sources/types.js';
import { withTrace } from './with-trace.js';

interface TraceableData {
  traceId?: string;
}

interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
}

interface JobRecord {
  jobName: string;
  jobId: string;
  attempt: number;
  traceId: string;
}

const MAX_ERROR_LENGTH = 4000;

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

function toHealthErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.length <= MAX_ERROR_LENGTH) {
    return message;
  }

  return message.slice(0, MAX_ERROR_LENGTH);
}

function computeWaitMs(timestamp: number): number | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return undefined;
  }

  return Math.max(0, Date.now() - timestamp);
}

function toJobKey(jobId: string): string {
  return jobId;
}

function resolveCompletedAttempt(job: Job<TraceableData>): number {
  // BullMQ attemptsMade tracks failed attempts, not successful completions.
  return Math.max(1, job.attemptsMade + 1);
}

function resolveFailedAttempt(job: Job<TraceableData>): number {
  return Math.max(1, job.attemptsMade);
}

function resolveStartedAt(job: Job<TraceableData>, startedAt: number | undefined): number {
  if (startedAt !== undefined) {
    return startedAt;
  }

  if (typeof job.processedOn === 'number' && job.processedOn > 0) {
    return job.processedOn;
  }

  return Date.now();
}

function baseJobRecord<TData extends TraceableData>(
  queue: string,
  job: Job<TData>,
  traceId: string,
  attempt: number,
): JobRecord & { queue: string } {
  return {
    queue,
    jobName: job.name,
    jobId: String(job.id ?? 'unknown'),
    attempt,
    traceId,
  };
}

async function recordHealthSuccess(
  db: Database,
  sourceId: string,
  stage: SourceStage,
  durationMs: number,
): Promise<void> {
  const now = new Date();

  await db
    .insert(sourceHealth)
    .values({
      sourceId,
      stage,
      status: 'healthy',
      lastRunAt: now,
      lastSuccessAt: now,
      consecutiveFailures: 0,
      lastDurationMs: durationMs,
      lastError: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [sourceHealth.sourceId, sourceHealth.stage],
      set: {
        status: 'healthy',
        lastRunAt: now,
        lastSuccessAt: now,
        consecutiveFailures: 0,
        lastDurationMs: durationMs,
        lastError: null,
        updatedAt: now,
      },
    });
}

async function recordHealthFailure(
  db: Database,
  sourceId: string,
  stage: SourceStage,
  durationMs: number,
  error: unknown,
): Promise<void> {
  const now = new Date();

  await db
    .insert(sourceHealth)
    .values({
      sourceId,
      stage,
      status: 'failing',
      lastRunAt: now,
      lastErrorAt: now,
      consecutiveFailures: 1,
      lastDurationMs: durationMs,
      lastError: toHealthErrorMessage(error),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [sourceHealth.sourceId, sourceHealth.stage],
      set: {
        status: 'failing',
        lastRunAt: now,
        lastErrorAt: now,
        consecutiveFailures: sql`${sourceHealth.consecutiveFailures} + 1`,
        lastDurationMs: durationMs,
        lastError: toHealthErrorMessage(error),
        updatedAt: now,
      },
    });
}

export async function isSourceHealthAvailable(db: Database): Promise<boolean> {
  try {
    await db.select({ sourceId: sourceHealth.sourceId }).from(sourceHealth).limit(1);
    return true;
  } catch {
    return false;
  }
}

export interface WorkerTelemetryOptions<TData extends TraceableData, TResult> {
  logger: Logger;
  db: Database;
  queue: string;
  stage: SourceStage;
  healthEnabled: boolean;
  resolveSourceId?: (job: Job<TData>, result?: TResult) => string | undefined;
  context?: (job: Job<TData>, traceId: string) => Record<string, unknown>;
  summary?: (job: Job<TData>, result: TResult) => Record<string, unknown>;
}

export interface WorkerTelemetryHandle {
  flush: () => Promise<void>;
}

export function attachWorkerTelemetry<TData extends TraceableData, TResult>(
  worker: Worker<TData, TResult>,
  options: WorkerTelemetryOptions<TData, TResult>,
): WorkerTelemetryHandle {
  const startedAtByJob = new Map<string, number>();
  const pendingHealthWrites = new Set<Promise<void>>();

  function safeContext(job: Job<TData>, traceId: string): Record<string, unknown> {
    if (!options.context) {
      return {};
    }

    try {
      return options.context(job, traceId);
    } catch (error) {
      options.logger.warn(
        {
          event: 'job_context_build_failed',
          queue: options.queue,
          jobName: job.name,
          jobId: String(job.id ?? 'unknown'),
          stage: options.stage,
          error: serializeError(error),
        },
        'Failed to build job telemetry context',
      );

      return {};
    }
  }

  function safeSummary(job: Job<TData>, result: TResult): Record<string, unknown> {
    if (!options.summary) {
      return {};
    }

    try {
      return options.summary(job, result);
    } catch (error) {
      options.logger.warn(
        {
          event: 'job_summary_build_failed',
          queue: options.queue,
          jobName: job.name,
          jobId: String(job.id ?? 'unknown'),
          stage: options.stage,
          error: serializeError(error),
        },
        'Failed to build job telemetry summary',
      );

      return {};
    }
  }

  function trackHealthWrite(
    mode: 'success' | 'failure',
    sourceId: string,
    run: () => Promise<void>,
  ): void {
    const write = run()
      .catch((healthError) => {
        options.logger.warn(
          {
            event: 'source_health_update_failed',
            sourceId,
            stage: options.stage,
            mode,
            healthError,
          },
          `Failed to record source health ${mode} state`,
        );
      })
      .finally(() => pendingHealthWrites.delete(write));

    pendingHealthWrites.add(write);
  }

  worker.on('active', (job) => {
    if (!job) {
      return;
    }

    const traceId = withTrace(job);
    const attempt = job.attemptsMade + 1;
    const common = baseJobRecord(options.queue, job, traceId, attempt);
    const jobKey = toJobKey(common.jobId);
    startedAtByJob.set(jobKey, Date.now());

    options.logger.info(
      {
        event: 'job_started',
        ...common,
        waitMs: computeWaitMs(job.timestamp),
        ...safeContext(job, traceId),
      },
      'Job started',
    );
  });

  worker.on('completed', (job, result) => {
    if (!job) {
      return;
    }

    const traceId = withTrace(job);
    const attempt = resolveCompletedAttempt(job);
    const common = baseJobRecord(options.queue, job, traceId, attempt);
    const jobKey = toJobKey(common.jobId);
    const startedAt = resolveStartedAt(job, startedAtByJob.get(jobKey));
    startedAtByJob.delete(jobKey);
    const durationMs = Math.max(0, Date.now() - startedAt);

    options.logger.info(
      {
        event: 'job_completed',
        ...common,
        ...safeContext(job, traceId),
        durationMs,
        ...safeSummary(job, result),
      },
      'Job completed',
    );

    if (!options.healthEnabled) {
      return;
    }

    const sourceId = options.resolveSourceId?.(job, result);
    if (!sourceId) {
      return;
    }

    trackHealthWrite('success', sourceId, () => recordHealthSuccess(options.db, sourceId, options.stage, durationMs));
  });

  worker.on('failed', (job, error) => {
    if (!job) {
      options.logger.error(
        {
          event: 'job_failed',
          queue: options.queue,
          error: serializeError(error),
        },
        'Job failed',
      );
      return;
    }

    const traceId = withTrace(job);
    const attempt = resolveFailedAttempt(job);
    const common = baseJobRecord(options.queue, job, traceId, attempt);
    const jobKey = toJobKey(common.jobId);
    const startedAt = resolveStartedAt(job, startedAtByJob.get(jobKey));
    startedAtByJob.delete(jobKey);
    const durationMs = Math.max(0, Date.now() - startedAt);

    options.logger.error(
      {
        event: 'job_failed',
        ...common,
        ...safeContext(job, traceId),
        durationMs,
        error: serializeError(error),
      },
      'Job failed',
    );

    if (!options.healthEnabled) {
      return;
    }

    const sourceId = options.resolveSourceId?.(job);
    if (!sourceId) {
      return;
    }

    trackHealthWrite('failure', sourceId, () =>
      recordHealthFailure(options.db, sourceId, options.stage, durationMs, error),
    );
  });

  return {
    async flush(): Promise<void> {
      if (pendingHealthWrites.size === 0) {
        return;
      }

      await Promise.allSettled([...pendingHealthWrites]);
    },
  };
}
