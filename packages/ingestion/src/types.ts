import type { ValidatedRawJob } from '@opencruit/parser-sdk';
import type { Database } from '@opencruit/db';

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
 * Per-stage counts for observability.
 */
export interface StageStats {
  parsed: number;
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
 * Result of ingesting a single parser.
 */
export interface ParserIngestionResult {
  parserId: string;
  parserName: string;
  stats: StageStats;
  errors: string[];
  durationMs: number;
}

/**
 * Result of ingesting all parsers.
 */
export interface IngestionResult {
  parsers: ParserIngestionResult[];
  totalStored: number;
  totalErrors: number;
  durationMs: number;
}

/**
 * Options for the ingest function.
 */
export interface IngestionOptions {
  db: Database;
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
