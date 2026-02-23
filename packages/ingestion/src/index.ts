// Pipeline
export { ingestBatch } from './pipeline.js';

// Individual stages
export { validate } from './validate.js';
export {
  normalize,
  normalizeWhitespace,
  stripHtml,
  stripRemoteOKSpam,
  normalizeTags,
  normalizeLocation,
} from './normalize.js';
export { computeFingerprint, fingerprintJob, fingerprintJobs } from './fingerprint.js';
export { dedup } from './dedup.js';
export { store, computeContentHash, computeNextCheckAt } from './store.js';

// Types
export type {
  NormalizedJob,
  FingerprintedJob,
  DedupOutcome,
  BatchStageStats,
  BatchIngestionResult,
  IngestBatchOptions,
  IngestionLogger,
} from './types.js';
