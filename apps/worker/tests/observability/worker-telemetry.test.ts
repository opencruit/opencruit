import { EventEmitter } from 'node:events';
import type { Database } from '@opencruit/db';
import type { Job, Worker } from 'bullmq';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { attachWorkerTelemetry, isSourceHealthAvailable } from '../../src/observability/worker-telemetry.js';
import { stub } from '../test-helpers.js';

interface TraceableData {
  traceId?: string;
}

function createLoggerMock(): Logger {
  return stub<Logger>({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
}

function createDbWriteMock(): {
  db: Database;
  insert: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
} {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: stub<Database>({ insert }),
    insert,
    values,
    onConflictDoUpdate,
  };
}

function createDbSelectMock(result: unknown): {
  db: Database;
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
} {
  const limit = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ from });

  return {
    db: stub<Database>({ select }),
    select,
    from,
    limit,
  };
}

function createJob<TData extends TraceableData>(overrides: Partial<Job<TData>> = {}): Job<TData> {
  return {
    id: 'job-1',
    name: 'source.ingest',
    attemptsMade: 0,
    timestamp: Date.now() - 200,
    data: {} as TData,
    ...overrides,
  } as Job<TData>;
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('worker telemetry', () => {
  it('logs start/completion and writes healthy source state', async () => {
    const logger = createLoggerMock();
    const { db, insert, values } = createDbWriteMock();
    const emitter = new EventEmitter();
    const worker = stub<Worker<TraceableData, { upserted: number }>>(emitter);
    const job = createJob<TraceableData>({
      attemptsMade: 1,
      data: {
        traceId: '',
      },
      name: 'source-ingest',
    });

    const telemetry = attachWorkerTelemetry(worker, {
      logger,
      db,
      queue: 'source.ingest',
      stage: 'ingest',
      healthEnabled: true,
      resolveSourceId: () => 'remoteok',
      context: () => ({
        sourceId: 'remoteok',
      }),
      summary: (_job, result) => ({
        upserted: result.upserted,
      }),
    });

    emitter.emit('active', job);
    emitter.emit('completed', job, { upserted: 3 });
    await telemetry.flush();

    expect(job.data.traceId).toBeTruthy();
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(2);

    const [startedPayload] = vi.mocked(logger.info).mock.calls[0]!;
    expect(startedPayload).toMatchObject({
      event: 'job_started',
      queue: 'source.ingest',
      sourceId: 'remoteok',
      attempt: 2,
    });

    const [completedPayload] = vi.mocked(logger.info).mock.calls[1]!;
    expect(completedPayload).toMatchObject({
      event: 'job_completed',
      queue: 'source.ingest',
      sourceId: 'remoteok',
      upserted: 3,
      attempt: 2,
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'remoteok',
        stage: 'ingest',
        status: 'healthy',
        consecutiveFailures: 0,
      }),
    );
  });

  it('logs failure and writes failing source state', async () => {
    const logger = createLoggerMock();
    const { db, insert, values } = createDbWriteMock();
    const emitter = new EventEmitter();
    const worker = stub<Worker<TraceableData, unknown>>(emitter);
    const job = createJob<TraceableData>({
      id: 'job-2',
      name: 'hh-hydrate',
      attemptsMade: 1,
    });

    const telemetry = attachWorkerTelemetry(worker, {
      logger,
      db,
      queue: 'hh.hydrate',
      stage: 'hydrate',
      healthEnabled: true,
      resolveSourceId: () => 'hh',
      context: () => ({
        sourceId: 'hh',
      }),
    });

    const error = new Error('boom');
    emitter.emit('active', job);
    emitter.emit('failed', job, error);
    await telemetry.flush();

    expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1);
    const [errorPayload] = vi.mocked(logger.error).mock.calls[0]!;
    expect(errorPayload).toMatchObject({
      event: 'job_failed',
      queue: 'hh.hydrate',
      sourceId: 'hh',
      jobId: 'job-2',
      attempt: 1,
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'hh',
        stage: 'hydrate',
        status: 'failing',
        consecutiveFailures: 1,
        lastError: 'boom',
      }),
    );
  });

  it('skips source health write when source id is not resolved', async () => {
    const logger = createLoggerMock();
    const { db, insert } = createDbWriteMock();
    const emitter = new EventEmitter();
    const worker = stub<Worker<TraceableData, { processedSources: number }>>(emitter);
    const job = createJob<TraceableData>({
      id: 'job-3',
      name: 'source-gc',
    });

    const telemetry = attachWorkerTelemetry(worker, {
      logger,
      db,
      queue: 'source.gc',
      stage: 'gc',
      healthEnabled: true,
      resolveSourceId: () => undefined,
      summary: (_job, result) => ({
        processedSources: result.processedSources,
      }),
    });

    emitter.emit('active', job);
    emitter.emit('completed', job, { processedSources: 2 });
    await telemetry.flush();

    expect(insert).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(2);
  });

  it('does not break job events when context/summary callbacks throw', async () => {
    const logger = createLoggerMock();
    const { db } = createDbWriteMock();
    const emitter = new EventEmitter();
    const worker = stub<Worker<TraceableData, { ok: boolean }>>(emitter);
    const job = createJob<TraceableData>({
      id: 'job-4',
      name: 'source-ingest',
    });

    const telemetry = attachWorkerTelemetry(worker, {
      logger,
      db,
      queue: 'source.ingest',
      stage: 'ingest',
      healthEnabled: false,
      context: () => {
        throw new Error('bad context');
      },
      summary: () => {
        throw new Error('bad summary');
      },
    });

    emitter.emit('active', job);
    emitter.emit('completed', job, { ok: true });
    await telemetry.flush();
    await flushAsync();

    expect(vi.mocked(logger.warn)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(2);
    const [startedPayload] = vi.mocked(logger.info).mock.calls[0]!;
    const [completedPayload] = vi.mocked(logger.info).mock.calls[1]!;
    expect(startedPayload).toMatchObject({
      event: 'job_started',
      queue: 'source.ingest',
    });
    expect(completedPayload).toMatchObject({
      event: 'job_completed',
      queue: 'source.ingest',
    });
  });
});

describe('isSourceHealthAvailable', () => {
  it('returns true when table is queryable', async () => {
    const { db, select } = createDbSelectMock([]);
    await expect(isSourceHealthAvailable(db)).resolves.toBe(true);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('returns false when select fails', async () => {
    const select = vi.fn().mockImplementation(() => {
      throw new Error('relation missing');
    });
    const db = stub<Database>({ select });

    await expect(isSourceHealthAvailable(db)).resolves.toBe(false);
  });
});
