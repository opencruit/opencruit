import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { jobs } from '@opencruit/db';
import { db } from '$lib/server/db';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
  const [row] = await db.select().from(jobs).where(eq(jobs.externalId, params.id)).limit(1);

  if (!row) {
    error(404, 'Job not found');
  }

  return {
    job: {
      externalId: row.externalId,
      sourceId: row.sourceId,
      url: row.url,
      title: row.title,
      company: row.company,
      companyLogoUrl: row.companyLogoUrl ?? undefined,
      location: row.location ?? undefined,
      isRemote: row.isRemote ?? undefined,
      description: row.description,
      descriptionRich: row.descriptionRich ?? undefined,
      tags: row.tags ?? undefined,
      salary:
        row.salaryMin !== null || row.salaryMax !== null
          ? { min: row.salaryMin ?? undefined, max: row.salaryMax ?? undefined, currency: row.salaryCurrency ?? undefined }
          : undefined,
      postedAt: row.postedAt?.toISOString(),
      applyUrl: row.applyUrl ?? undefined,
    },
  };
};
