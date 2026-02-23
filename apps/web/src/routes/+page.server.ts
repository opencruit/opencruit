import type { PageServerLoad } from './$types';
import { parse } from '@opencruit/parser-remoteok';
import { getCachedJobs, setCachedJobs } from '$lib/server/cache';
import type { JobSummary } from '$lib/types';
import type { RawJob } from '@opencruit/parser-sdk';

function toSummary(job: RawJob): JobSummary {
  return {
    externalId: job.externalId,
    url: job.url,
    title: job.title,
    company: job.company,
    companyLogoUrl: job.companyLogoUrl,
    location: job.location,
    isRemote: job.isRemote,
    tags: job.tags,
    salary: job.salary,
    postedAt: job.postedAt?.toISOString(),
    applyUrl: job.applyUrl,
  };
}

export const load: PageServerLoad = async () => {
  let jobs = getCachedJobs();

  if (!jobs) {
    try {
      const result = await parse();
      jobs = result.jobs;
      setCachedJobs(jobs);
    } catch (err) {
      console.error('[web] Failed to fetch jobs from RemoteOK:', err);
      return { jobs: [] as JobSummary[], error: 'Failed to fetch jobs. Please try again later.' };
    }
  }

  return {
    jobs: jobs.map(toSummary),
  };
};
