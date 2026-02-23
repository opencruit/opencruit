import type { PageServerLoad } from './$types';
import { jobs } from '@opencruit/db';
import { db } from '$lib/server/db';
import { desc } from 'drizzle-orm';
import type { JobSummary } from '$lib/types';

export const load: PageServerLoad = async () => {
  const rows = await db
    .select({
      externalId: jobs.externalId,
      url: jobs.url,
      title: jobs.title,
      company: jobs.company,
      companyLogoUrl: jobs.companyLogoUrl,
      location: jobs.location,
      isRemote: jobs.isRemote,
      tags: jobs.tags,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      salaryCurrency: jobs.salaryCurrency,
      postedAt: jobs.postedAt,
      applyUrl: jobs.applyUrl,
    })
    .from(jobs)
    .orderBy(desc(jobs.postedAt));

  const result: JobSummary[] = rows.map((row) => ({
    externalId: row.externalId,
    url: row.url,
    title: row.title,
    company: row.company,
    companyLogoUrl: row.companyLogoUrl ?? undefined,
    location: row.location ?? undefined,
    isRemote: row.isRemote ?? undefined,
    tags: row.tags ?? undefined,
    salary:
      row.salaryMin || row.salaryMax
        ? { min: row.salaryMin ?? undefined, max: row.salaryMax ?? undefined, currency: row.salaryCurrency ?? undefined }
        : undefined,
    postedAt: row.postedAt?.toISOString(),
    applyUrl: row.applyUrl ?? undefined,
  }));

  return { jobs: result };
};
