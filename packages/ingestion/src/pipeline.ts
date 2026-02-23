import type { Parser } from '@opencruit/parser-sdk';
import type { IngestionOptions, IngestionResult, ParserIngestionResult, StageStats, IngestionLogger } from './types.js';
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
 * Ingest jobs from a single parser through the full pipeline.
 * Stages: parse → validate → normalize → fingerprint → dedup → store
 */
async function ingestParser(parser: Parser, options: IngestionOptions): Promise<ParserIngestionResult> {
  const { db, logger = defaultLogger } = options;
  const { id, name } = parser.manifest;
  const start = performance.now();
  const errors: string[] = [];

  const stats: StageStats = {
    parsed: 0,
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
    // 1. Parse
    logger.info(`[ingest:${id}] Fetching jobs from ${name}...`);
    const parseResult = await parser.parse();
    stats.parsed = parseResult.jobs.length;
    logger.info(`[ingest:${id}] Received ${stats.parsed} jobs`);

    if (stats.parsed === 0) {
      return { parserId: id, parserName: name, stats, errors, durationMs: performance.now() - start };
    }

    // 2. Validate
    const { valid, invalidCount } = validate(parseResult.jobs);
    stats.validated = valid.length;
    stats.validationDropped = invalidCount;
    if (invalidCount > 0) {
      logger.warn(`[ingest:${id}] ${invalidCount} jobs failed validation`);
    }

    if (valid.length === 0) {
      return { parserId: id, parserName: name, stats, errors, durationMs: performance.now() - start };
    }

    // 3. Normalize
    const normalized = valid.map(normalize);
    stats.normalized = normalized.length;

    // 4. Fingerprint
    const fingerprinted = fingerprintJobs(normalized);
    stats.fingerprinted = fingerprinted.length;

    // 5. Dedup (Tier 2)
    const outcomes = await dedup(fingerprinted, db);
    stats.dedupPlannedInserts = outcomes.filter((o) => o.action === 'insert').length;
    stats.dedupPlannedUpdates = outcomes.filter((o) => o.action === 'update').length;
    stats.dedupSkipped = outcomes.filter((o) => o.action === 'skip').length;

    if (stats.dedupSkipped > 0) {
      logger.info(`[ingest:${id}] ${stats.dedupSkipped} jobs skipped (fingerprint duplicate)`);
    }

    // 6. Store
    const storeResult = await store(outcomes, db);
    stats.upserted = storeResult.upserted;
    logger.info(
      `[ingest:${id}] ${storeResult.upserted} jobs upserted (planned: ${storeResult.plannedInserts} insert, ${storeResult.plannedUpdates} update)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    logger.error(`[ingest:${id}] Error: ${message}`);
  }

  return {
    parserId: id,
    parserName: name,
    stats,
    errors,
    durationMs: performance.now() - start,
  };
}

/**
 * Run the full ingestion pipeline for an array of parsers.
 * Parsers are processed sequentially to avoid rate-limiting.
 */
export async function ingest(parsers: Parser[], options: IngestionOptions): Promise<IngestionResult> {
  const { logger = defaultLogger } = options;
  const start = performance.now();
  const results: ParserIngestionResult[] = [];

  for (const parser of parsers) {
    const result = await ingestParser(parser, options);
    results.push(result);
  }

  const totalStored = results.reduce((sum, r) => sum + r.stats.upserted, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  logger.info(`[ingest] Done. ${totalStored} total jobs stored across ${parsers.length} parsers.`);

  if (totalErrors > 0) {
    const failedIds = results.filter((r) => r.errors.length > 0).map((r) => r.parserId);
    logger.error(`[ingest] ${totalErrors} parser(s) failed: ${failedIds.join(', ')}`);
  }

  return {
    parsers: results,
    totalStored,
    totalErrors,
    durationMs: performance.now() - start,
  };
}
