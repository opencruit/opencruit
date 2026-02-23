import type { RawJob, ValidatedRawJob } from '@opencruit/parser-sdk';
import { validateRawJobs } from '@opencruit/parser-sdk';

export interface ValidationResult {
  valid: ValidatedRawJob[];
  invalidCount: number;
}

/**
 * Validate raw jobs using the parser-sdk Zod schema.
 * Returns valid jobs and a count of dropped jobs.
 */
export function validate(jobs: RawJob[]): ValidationResult {
  const valid = validateRawJobs(jobs);
  return {
    valid,
    invalidCount: jobs.length - valid.length,
  };
}
