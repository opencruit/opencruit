import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const jobs = pgTable(
  'jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    sourceId: varchar('source_id', { length: 100 }).notNull(),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    url: text().notNull(),
    title: text().notNull(),
    company: varchar({ length: 255 }).notNull(),
    companyLogoUrl: text('company_logo_url'),
    location: varchar({ length: 255 }),
    isRemote: boolean('is_remote').default(false),
    description: text().notNull(),
    descriptionRich: text('description_rich'),
    tags: text().array(),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    salaryCurrency: varchar('salary_currency', { length: 10 }),
    postedAt: timestamp('posted_at'),
    applyUrl: text('apply_url'),
    fingerprint: varchar({ length: 64 }).notNull(),
    raw: jsonb(),
    status: varchar({ length: 20 }).default('active').notNull(),
    contentHash: varchar('content_hash', { length: 64 }),
    lastCheckedAt: timestamp('last_checked_at'),
    nextCheckAt: timestamp('next_check_at'),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    search: tsvector('search').generatedAlwaysAs(
      (): ReturnType<typeof sql> =>
        sql`setweight(to_tsvector('english', coalesce(${jobs.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${jobs.company}, '')), 'B') || setweight(to_tsvector('english', coalesce(${jobs.description}, '')), 'C')`,
    ),
  },
  (t) => [
    uniqueIndex('uq_jobs_source_external').on(t.sourceId, t.externalId),
    index('idx_jobs_fingerprint').on(t.fingerprint),
    index('idx_jobs_search').using('gin', t.search),
    index('idx_jobs_posted_at').on(t.postedAt),
    index('idx_jobs_status').on(t.status),
    index('idx_jobs_next_check_at').on(t.nextCheckAt),
    index('idx_jobs_source_status_next_check').on(t.sourceId, t.status, t.nextCheckAt),
  ],
);

export const sourceCursors = pgTable(
  'source_cursors',
  {
    source: varchar({ length: 100 }).notNull(),
    segmentKey: varchar('segment_key', { length: 255 }).notNull(),
    lastPolledAt: timestamp('last_polled_at'),
    cursor: jsonb(),
    stats: jsonb(),
  },
  (t) => [uniqueIndex('uq_source_cursors_pk').on(t.source, t.segmentKey)],
);

export const sourceHealth = pgTable(
  'source_health',
  {
    sourceId: varchar('source_id', { length: 100 }).notNull(),
    stage: varchar({ length: 50 }).notNull(),
    status: varchar({ length: 20 }).default('healthy').notNull(),
    lastRunAt: timestamp('last_run_at'),
    lastSuccessAt: timestamp('last_success_at'),
    lastErrorAt: timestamp('last_error_at'),
    consecutiveFailures: integer('consecutive_failures').default(0).notNull(),
    lastDurationMs: integer('last_duration_ms'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uq_source_health_pk').on(t.sourceId, t.stage),
    index('idx_source_health_status').on(t.status),
    index('idx_source_health_updated_at').on(t.updatedAt),
  ],
);
