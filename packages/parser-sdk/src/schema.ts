import { z } from 'zod';

export const rawJobSchema = z.object({
  sourceId: z.string().min(1),
  externalId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  company: z.string().min(1),
  companyLogoUrl: z.string().url().optional(),
  location: z.string().optional(),
  isRemote: z.boolean().optional(),
  description: z.string().min(1),
  tags: z.array(z.string()).optional(),
  salary: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      currency: z.string().optional(),
    })
    .optional(),
  postedAt: z.date().optional(),
  applyUrl: z.string().url().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export type ValidatedRawJob = z.infer<typeof rawJobSchema>;

export interface ValidateRawJobsOptions {
  onInvalid?: (issues: z.ZodIssue[], job: unknown) => void;
}

export function validateRawJobs(jobs: unknown[], options?: ValidateRawJobsOptions): ValidatedRawJob[] {
  const valid: ValidatedRawJob[] = [];

  for (const job of jobs) {
    const result = rawJobSchema.safeParse(job);
    if (result.success) {
      valid.push(result.data);
    } else {
      options?.onInvalid?.(result.error.issues, job);
    }
  }

  return valid;
}
