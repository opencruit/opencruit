import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { parse } from '@opencruit/parser-remoteok';
import { getCachedJobs, setCachedJobs, getCachedJobById } from '$lib/server/cache';

export const load: PageServerLoad = async ({ params }) => {
  if (!getCachedJobs()) {
    try {
      const result = await parse();
      setCachedJobs(result.jobs);
    } catch {
      error(503, 'Could not fetch jobs');
    }
  }

  const job = getCachedJobById(params.id);
  if (!job) {
    error(404, 'Job not found');
  }

  return {
    job: {
      externalId: job.externalId,
      url: job.url,
      title: job.title,
      company: job.company,
      companyLogoUrl: job.companyLogoUrl,
      location: job.location,
      isRemote: job.isRemote,
      description: job.description,
      tags: job.tags,
      salary: job.salary,
      postedAt: job.postedAt?.toISOString(),
      applyUrl: job.applyUrl,
    },
  };
};
