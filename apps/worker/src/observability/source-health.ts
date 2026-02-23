import { sourceHealth, type Database } from '@opencruit/db';
import { sql } from 'drizzle-orm';
import type { SourceStage } from '../sources/types.js';

const MAX_ERROR_LENGTH = 4000;

export type SourceHealthStage = SourceStage;

export interface SourceHealthSuccessInput {
  sourceId: string;
  stage: SourceHealthStage;
  durationMs: number;
}

export interface SourceHealthFailureInput extends SourceHealthSuccessInput {
  error: unknown;
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.length <= MAX_ERROR_LENGTH) {
    return message;
  }

  return message.slice(0, MAX_ERROR_LENGTH);
}

export async function recordSourceHealthSuccess(db: Database, input: SourceHealthSuccessInput): Promise<void> {
  const now = new Date();

  await db
    .insert(sourceHealth)
    .values({
      sourceId: input.sourceId,
      stage: input.stage,
      status: 'healthy',
      lastRunAt: now,
      lastSuccessAt: now,
      consecutiveFailures: 0,
      lastDurationMs: input.durationMs,
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
        lastDurationMs: input.durationMs,
        lastError: null,
        updatedAt: now,
      },
    });
}

export async function recordSourceHealthFailure(db: Database, input: SourceHealthFailureInput): Promise<void> {
  const now = new Date();

  await db
    .insert(sourceHealth)
    .values({
      sourceId: input.sourceId,
      stage: input.stage,
      status: 'failing',
      lastRunAt: now,
      lastErrorAt: now,
      consecutiveFailures: 1,
      lastDurationMs: input.durationMs,
      lastError: toErrorMessage(input.error),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [sourceHealth.sourceId, sourceHealth.stage],
      set: {
        status: 'failing',
        lastRunAt: now,
        lastErrorAt: now,
        consecutiveFailures: sql`${sourceHealth.consecutiveFailures} + 1`,
        lastDurationMs: input.durationMs,
        lastError: toErrorMessage(input.error),
        updatedAt: now,
      },
    });
}
