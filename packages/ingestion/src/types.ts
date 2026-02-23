import type { ValidatedRawJob } from '@opencruit/parser-sdk';

/**
 * After normalization: all text fields cleaned, tags lowercased/deduped,
 * HTML stripped from descriptions. Branded type to prevent mixing with raw validated jobs.
 */
export interface NormalizedJob extends ValidatedRawJob {
  readonly _normalized: true;
}

/**
 * After fingerprinting: normalized job + computed sha256 hash.
 */
export interface FingerprintedJob {
  job: NormalizedJob;
  fingerprint: string;
}

/**
 * Outcome for a single job after dedup check.
 */
export type DedupOutcome =
  | { action: 'insert'; job: FingerprintedJob }
  | { action: 'update'; job: FingerprintedJob; existingId: string }
  | { action: 'skip'; job: FingerprintedJob; reason: string };

/**
 * Per-stage counts for observability in a single batch run.
 */
export interface BatchStageStats {
  received: number;
  validated: number;
  validationDropped: number;
  normalized: number;
  fingerprinted: number;
  dedupPlannedInserts: number;
  dedupPlannedUpdates: number;
  dedupSkipped: number;
  upserted: number;
}

/**
 * Result of ingesting a batch of raw jobs.
 */
export interface BatchIngestionResult {
  sourceId?: string;
  stats: BatchStageStats;
  errors: string[];
  durationMs: number;
}

/**
 * Options for ingesting a batch.
 */
export interface IngestBatchOptions {
  sourceId?: string;
  logger?: IngestionLogger;
}

/**
 * Minimal logger interface — defaults to console.
 */
export interface IngestionLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}
