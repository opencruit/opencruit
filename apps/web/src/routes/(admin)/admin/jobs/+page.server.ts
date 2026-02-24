import type { PageServerLoad } from './$types';
import { jobs } from '@opencruit/db';
import { db } from '$lib/server/db';
import { desc, sql, and, eq, gte, lt } from 'drizzle-orm';
import { KNOWN_SOURCES } from '$lib/sources.js';

const PAGE_SIZE = 50;

function parsePage(value: string | null): number {
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseIsoDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return Number.isNaN(date.getTime()) ? null : date;
}

function nextUtcDay(date: Date): Date {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + 1);
  return value;
}

export const load: PageServerLoad = async ({ url }) => {
  const query = url.searchParams.get('q')?.trim() ?? '';
  const sourceFilter = url.searchParams.get('source') ?? '';
  const statusFilter = url.searchParams.get('status') ?? '';
  const dateFrom = url.searchParams.get('from') ?? '';
  const dateTo = url.searchParams.get('to') ?? '';
  const requestedPage = parsePage(url.searchParams.get('page'));

  const conditions = [];

  if (query.length > 0) {
    const ilikePattern = `%${query}%`;
    conditions.push(
      sql`(
        ${jobs.search} @@ plainto_tsquery('english', ${query})
        OR ${jobs.title} ILIKE ${ilikePattern}
        OR ${jobs.company} ILIKE ${ilikePattern}
      )`,
    );
  }

  if (sourceFilter.length > 0) {
    conditions.push(eq(jobs.sourceId, sourceFilter));
  }

  if (statusFilter.length > 0) {
    conditions.push(eq(jobs.status, statusFilter));
  }

  if (dateFrom.length > 0) {
    const date = parseIsoDateInput(dateFrom);
    if (date) {
      conditions.push(gte(jobs.firstSeenAt, date));
    }
  }

  if (dateTo.length > 0) {
    const date = parseIsoDateInput(dateTo);
    if (date) {
      conditions.push(lt(jobs.firstSeenAt, nextUtcDay(date)));
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countQuery = db.select({ count: sql<number>`count(*)::int` }).from(jobs);
  const [countRow] = whereClause ? await countQuery.where(whereClause) : await countQuery;

  const total = countRow?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const rowsQuery = db
    .select({
      id: jobs.id,
      externalId: jobs.externalId,
      sourceId: jobs.sourceId,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      status: jobs.status,
      isRemote: jobs.isRemote,
      postedAt: jobs.postedAt,
      firstSeenAt: jobs.firstSeenAt,
      lastSeenAt: jobs.lastSeenAt,
    })
    .from(jobs);

  const rows = await (whereClause ? rowsQuery.where(whereClause) : rowsQuery)
    .orderBy(desc(jobs.firstSeenAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  return {
    jobs: rows.map((row) => ({
      id: row.id,
      externalId: row.externalId,
      sourceId: row.sourceId,
      title: row.title,
      company: row.company,
      location: row.location ?? '',
      status: row.status,
      isRemote: row.isRemote ?? false,
      postedAt: row.postedAt?.toISOString() ?? null,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    })),
    filters: { query, source: sourceFilter, status: statusFilter, from: dateFrom, to: dateTo },
    pagination: { page, pageSize: PAGE_SIZE, total, totalPages },
    sources: KNOWN_SOURCES.map((s) => ({ id: s.id, label: s.label })),
  };
};
