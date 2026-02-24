import type { PageServerLoad } from './$types';
import { jobs } from '@opencruit/db';
import { db } from '$lib/server/db';
import { desc, sql } from 'drizzle-orm';
import type { JobSummary } from '$lib/types';

const PAGE_SIZE = 50;

function parsePage(value: string | null): number {
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export const load: PageServerLoad = async ({ url }) => {
  const query = url.searchParams.get('q')?.trim() ?? '';
  const requestedPage = parsePage(url.searchParams.get('page'));
  const ilikePattern = `%${query}%`;

  const whereClause =
    query.length > 0
      ? sql`(
          ${jobs.search} @@ plainto_tsquery('english', ${query})
          OR ${jobs.title} ILIKE ${ilikePattern}
          OR ${jobs.company} ILIKE ${ilikePattern}
          OR EXISTS (
            SELECT 1
            FROM unnest(${jobs.tags}) AS tag
            WHERE tag ILIKE ${ilikePattern}
          )
        )`
      : undefined;

  const countQuery = db.select({ count: sql<number>`count(*)::int` }).from(jobs);
  const [countRow] = whereClause ? await countQuery.where(whereClause) : await countQuery;

  const total = countRow?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const rowsQuery = db
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
    .from(jobs);

  const rows = await (whereClause ? rowsQuery.where(whereClause) : rowsQuery)
    .orderBy(sql`${jobs.postedAt} DESC NULLS LAST`, desc(jobs.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

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
      row.salaryMin !== null || row.salaryMax !== null
        ? { min: row.salaryMin ?? undefined, max: row.salaryMax ?? undefined, currency: row.salaryCurrency ?? undefined }
        : undefined,
    postedAt: row.postedAt?.toISOString(),
    applyUrl: row.applyUrl ?? undefined,
  }));

  return {
    jobs: result,
    filters: {
      query,
    },
    pagination: {
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages,
    },
  };
};
