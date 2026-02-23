import { sourceHealth, type Database } from '@opencruit/db';
import type { Logger } from 'pino';
import type { SourceStage } from '../sources/types.js';
import { recordSourceHealthFailure, recordSourceHealthSuccess } from './source-health.js';

export async function checkSourceHealthAvailability(db: Database): Promise<boolean> {
  try {
    await db.select({ sourceId: sourceHealth.sourceId }).from(sourceHealth).limit(1);
    return true;
  } catch {
    return false;
  }
}

export interface WithSourceHealthOptions<TResult> {
  db: Database;
  logger: Logger;
  sourceId?: string;
  stage: SourceStage;
  enabled: boolean;
  run: () => Promise<TResult>;
}

export async function withSourceHealth<TResult>({
  db,
  logger,
  sourceId,
  stage,
  enabled,
  run,
}: WithSourceHealthOptions<TResult>): Promise<TResult> {
  if (!enabled || !sourceId) {
    return run();
  }

  const startedAt = Date.now();

  try {
    const result = await run();
    const durationMs = Date.now() - startedAt;

    try {
      await recordSourceHealthSuccess(db, {
        sourceId,
        stage,
        durationMs,
      });
    } catch (healthError) {
      logger.warn(
        {
          event: 'source_health_update_failed',
          sourceId,
          stage,
          mode: 'success',
          healthError,
        },
        'Failed to record source health success state',
      );
    }

    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    try {
      await recordSourceHealthFailure(db, {
        sourceId,
        stage,
        durationMs,
        error,
      });
    } catch (healthError) {
      logger.warn(
        {
          event: 'source_health_update_failed',
          sourceId,
          stage,
          mode: 'failure',
          healthError,
        },
        'Failed to record source health failure state',
      );
    }

    throw error;
  }
}
