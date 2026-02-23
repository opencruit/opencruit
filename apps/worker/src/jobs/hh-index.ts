import { and, eq } from 'drizzle-orm';
import type { Job, Queue } from 'bullmq';
import { sourceCursors, type Database } from '@opencruit/db';
import { HhClient, buildSegmentKey, shouldSplit, splitTimeSlice } from '@opencruit/parser-hh';
import type { HhSearchVacancyItem, TimeSlice } from '@opencruit/parser-hh';
import type { HhHydrateJobData, HhIndexJobData } from '../queues.js';

const SOURCE_ID = 'hh';
const DEFAULT_LOOKBACK_DAYS = 30;
const CURSOR_OVERLAP_MINUTES = 10;
const MIN_SPLIT_WINDOW_MINUTES = 30;
const MAX_SPLIT_DEPTH = 8;
const MAX_PAGE_DEPTH = 20;
const PER_PAGE = 100;

export interface HhIndexJobDeps {
  client: HhClient;
  db: Database;
  hydrateQueue: Queue<HhHydrateJobData>;
  indexQueue: Queue<HhIndexJobData>;
}

export interface HhIndexResult {
  found: number;
  pagesFetched: number;
  enqueued: number;
  split: boolean;
}

function roleCursorKey(professionalRole: string): string {
  return `role:${professionalRole}`;
}

function parseIsoDate(value: string, fieldName: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName} value: ${value}`);
  }

  return date;
}

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function minutesBetween(startIso: string, endIso: string): number {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  return (endMs - startMs) / (1000 * 60);
}

function canSplit(slice: TimeSlice): boolean {
  return minutesBetween(slice.dateFromIso, slice.dateToIso) >= MIN_SPLIT_WINDOW_MINUTES * 2;
}

async function readCursor(db: Database, professionalRole: string): Promise<Date | null> {
  const rows = await db
    .select({ lastPolledAt: sourceCursors.lastPolledAt })
    .from(sourceCursors)
    .where(and(eq(sourceCursors.source, SOURCE_ID), eq(sourceCursors.segmentKey, roleCursorKey(professionalRole))))
    .limit(1);

  return rows[0]?.lastPolledAt ?? null;
}

async function upsertCursor(
  db: Database,
  professionalRole: string,
  lastPolledAt: Date,
  cursor: Record<string, unknown>,
  stats: Record<string, unknown>,
): Promise<void> {
  const segmentKey = roleCursorKey(professionalRole);
  const existing = await db
    .select({ lastPolledAt: sourceCursors.lastPolledAt })
    .from(sourceCursors)
    .where(and(eq(sourceCursors.source, SOURCE_ID), eq(sourceCursors.segmentKey, segmentKey)))
    .limit(1);

  const currentLastPolledAt = existing[0]?.lastPolledAt;
  const nextLastPolledAt =
    currentLastPolledAt && currentLastPolledAt.getTime() > lastPolledAt.getTime() ? currentLastPolledAt : lastPolledAt;

  await db
    .insert(sourceCursors)
    .values({
      source: SOURCE_ID,
      segmentKey,
      lastPolledAt: nextLastPolledAt,
      cursor,
      stats,
    })
    .onConflictDoUpdate({
      target: [sourceCursors.source, sourceCursors.segmentKey],
      set: {
        lastPolledAt: nextLastPolledAt,
        cursor,
        stats,
      },
    });
}

async function resolveWindow(jobData: HhIndexJobData, db: Database): Promise<TimeSlice> {
  if (jobData.dateFromIso && jobData.dateToIso) {
    const dateFrom = parseIsoDate(jobData.dateFromIso, 'dateFromIso');
    const dateTo = parseIsoDate(jobData.dateToIso, 'dateToIso');

    if (dateFrom.getTime() >= dateTo.getTime()) {
      throw new Error('Invalid time window: dateFromIso must be earlier than dateToIso');
    }

    return {
      dateFromIso: dateFrom.toISOString(),
      dateToIso: dateTo.toISOString(),
    };
  }

  const now = new Date();
  const initialStart = subDays(now, DEFAULT_LOOKBACK_DAYS);
  const cursor = await readCursor(db, jobData.professionalRole);

  if (!cursor) {
    return {
      dateFromIso: initialStart.toISOString(),
      dateToIso: now.toISOString(),
    };
  }

  const overlapStart = new Date(cursor.getTime() - CURSOR_OVERLAP_MINUTES * 60 * 1000);
  let dateFrom = overlapStart.getTime() > initialStart.getTime() ? overlapStart : initialStart;

  if (dateFrom.getTime() >= now.getTime()) {
    dateFrom = new Date(now.getTime() - 60 * 1000);
  }

  return {
    dateFromIso: dateFrom.toISOString(),
    dateToIso: now.toISOString(),
  };
}

async function enqueueHydrateItems(
  items: HhSearchVacancyItem[],
  hydrateQueue: Queue<HhHydrateJobData>,
  reason: HhHydrateJobData['reason'],
): Promise<number> {
  const seenVacancyIds = new Set<string>();
  let enqueued = 0;

  for (const item of items) {
    if (seenVacancyIds.has(item.id)) {
      continue;
    }

    seenVacancyIds.add(item.id);

    await hydrateQueue.add(
      'hh-hydrate',
      {
        vacancyId: item.id,
        reason,
      },
      {
        jobId: `hh-hydrate-${reason}-${item.id}`,
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );

    enqueued += 1;
  }

  return enqueued;
}

export async function handleHhIndexJob(job: Job<HhIndexJobData>, deps: HhIndexJobDeps): Promise<HhIndexResult> {
  const depth = job.data.depth ?? 0;
  const slice = await resolveWindow(job.data, deps.db);
  const segmentKey = buildSegmentKey(job.data.professionalRole, slice);

  const page0 = await deps.client.searchVacancies({
    professionalRole: job.data.professionalRole,
    dateFrom: slice.dateFromIso,
    dateTo: slice.dateToIso,
    page: 0,
    perPage: PER_PAGE,
  });

  if (shouldSplit(page0.found) && depth < MAX_SPLIT_DEPTH && canSplit(slice)) {
    const [left, right] = splitTimeSlice(slice);

    await deps.indexQueue.add(
      'hh-index',
      {
        professionalRole: job.data.professionalRole,
        dateFromIso: left.dateFromIso,
        dateToIso: left.dateToIso,
        depth: depth + 1,
      },
      {
        attempts: 4,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );

    await deps.indexQueue.add(
      'hh-index',
      {
        professionalRole: job.data.professionalRole,
        dateFromIso: right.dateFromIso,
        dateToIso: right.dateToIso,
        depth: depth + 1,
      },
      {
        attempts: 4,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );

    return {
      found: page0.found,
      pagesFetched: 1,
      enqueued: 0,
      split: true,
    };
  }

  const pagesToFetch = Math.min(page0.pages, MAX_PAGE_DEPTH);
  let enqueued = await enqueueHydrateItems(page0.items, deps.hydrateQueue, 'new');

  for (let page = 1; page < pagesToFetch; page += 1) {
    const response = await deps.client.searchVacancies({
      professionalRole: job.data.professionalRole,
      dateFrom: slice.dateFromIso,
      dateTo: slice.dateToIso,
      page,
      perPage: PER_PAGE,
    });

    enqueued += await enqueueHydrateItems(response.items, deps.hydrateQueue, 'new');
  }

  await upsertCursor(
    deps.db,
    job.data.professionalRole,
    new Date(slice.dateToIso),
    {
      segmentKey,
      dateFromIso: slice.dateFromIso,
      dateToIso: slice.dateToIso,
      depth,
    },
    {
      found: page0.found,
      pagesFetched: pagesToFetch,
      enqueued,
      split: false,
    },
  );

  return {
    found: page0.found,
    pagesFetched: pagesToFetch,
    enqueued,
    split: false,
  };
}
