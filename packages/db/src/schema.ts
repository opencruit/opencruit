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
    tags: text().array(),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    salaryCurrency: varchar('salary_currency', { length: 10 }),
    postedAt: timestamp('posted_at'),
    applyUrl: text('apply_url'),
    fingerprint: varchar({ length: 64 }).notNull(),
    raw: jsonb(),
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
  ],
);
