import type { RawJob } from '@opencruit/parser-sdk';
import type { Database } from '@opencruit/db';
import type { BatchIngestionResult, BatchStageStats, IngestBatchOptions, IngestionLogger } from './types.js';
import { validate } from './validate.js';
import { normalize } from './normalize.js';
import { fingerprintJobs } from './fingerprint.js';
import { dedup } from './dedup.js';
import { store } from './store.js';

const defaultLogger: IngestionLogger = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
};

/**
 * Ingest a raw jobs batch through the full pipeline.
 * Stages: validate → normalize → fingerprint → dedup → store
 */
export async function ingestBatch(rawJobs: RawJob[], db: Database, options: IngestBatchOptions = {}): Promise<BatchIngestionResult> {
  const { logger = defaultLogger, sourceId } = options;
  const start = performance.now();
  const errors: string[] = [];
  const logPrefix = sourceId ? `[ingest:${sourceId}]` : '[ingest]';

  const stats: BatchStageStats = {
    received: rawJobs.length,
    validated: 0,
    validationDropped: 0,
    normalized: 0,
    fingerprinted: 0,
    dedupPlannedInserts: 0,
    dedupPlannedUpdates: 0,
    dedupSkipped: 0,
    upserted: 0,
  };

  try {
    logger.info(`${logPrefix} Received ${stats.received} jobs`);
    if (stats.received === 0) {
      return {
        sourceId,
        stats,
        errors,
        durationMs: performance.now() - start,
      };
    }

    // 1. Validate
    const { valid, invalidCount } = validate(rawJobs);
    stats.validated = valid.length;
    stats.validationDropped = invalidCount;
    if (invalidCount > 0) {
      logger.warn(`${logPrefix} ${invalidCount} jobs failed validation`);
    }

    if (valid.length === 0) {
      return {
        sourceId,
        stats,
        errors,
        durationMs: performance.now() - start,
      };
    }

    // 2. Normalize
    const normalized = valid.map(normalize);
    stats.normalized = normalized.length;

    // 3. Fingerprint
    const fingerprinted = fingerprintJobs(normalized);
    stats.fingerprinted = fingerprinted.length;

    // 4. Dedup (Tier 2)
    const outcomes = await dedup(fingerprinted, db);
    stats.dedupPlannedInserts = outcomes.filter((o) => o.action === 'insert').length;
    stats.dedupPlannedUpdates = outcomes.filter((o) => o.action === 'update').length;
    stats.dedupSkipped = outcomes.filter((o) => o.action === 'skip').length;

    if (stats.dedupSkipped > 0) {
      logger.info(`${logPrefix} ${stats.dedupSkipped} jobs skipped (fingerprint duplicate)`);
    }

    // 5. Store
    const storeResult = await store(outcomes, db);
    stats.upserted = storeResult.upserted;
    logger.info(
      `${logPrefix} ${storeResult.upserted} jobs upserted (planned: ${storeResult.plannedInserts} insert, ${storeResult.plannedUpdates} update)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    logger.error(`${logPrefix} Error: ${message}`);
  }

  return {
    sourceId,
    stats,
    errors,
    durationMs: performance.now() - start,
  };
}
