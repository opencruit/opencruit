// Pipeline
export { ingest } from './pipeline.js';

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
export { store, computeContentHash } from './store.js';

// Types
export type {
  NormalizedJob,
  FingerprintedJob,
  DedupOutcome,
  StageStats,
  ParserIngestionResult,
  IngestionResult,
  IngestionOptions,
  IngestionLogger,
} from './types.js';
