import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client.js';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface JournalFile {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const LEGACY_TABLES = ['jobs', 'source_cursors', 'source_health'] as const;

async function tableExists(db: ReturnType<typeof createDatabase>, tableName: string): Promise<boolean> {
  const rows = await db.execute(sql`
    select exists(
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = ${tableName}
    ) as exists
  `);

  return Boolean(rows[0]?.exists);
}

async function ensureMigrationsTable(db: ReturnType<typeof createDatabase>): Promise<void> {
  await db.execute(sql`create schema if not exists "drizzle"`);
  await db.execute(sql`
    create table if not exists "drizzle"."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
}

async function migrationCount(db: ReturnType<typeof createDatabase>): Promise<number> {
  const rows = await db.execute(sql`select count(*)::int as count from "drizzle"."__drizzle_migrations"`);
  return Number(rows[0]?.count ?? 0);
}

async function loadJournal(): Promise<JournalFile> {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const journalPath = join(currentDir, '../drizzle/meta/_journal.json');
  const raw = await readFile(journalPath, 'utf8');

  return JSON.parse(raw) as JournalFile;
}

async function bootstrapLegacyDatabase(db: ReturnType<typeof createDatabase>): Promise<void> {
  const hasLegacySchema = (await Promise.all(LEGACY_TABLES.map((tableName) => tableExists(db, tableName)))).every(Boolean);
  if (!hasLegacySchema) {
    return;
  }

  await ensureMigrationsTable(db);
  const existingMigrationCount = await migrationCount(db);
  if (existingMigrationCount > 0) {
    return;
  }

  const journal = await loadJournal();
  if (journal.entries.length === 0) {
    throw new Error('No migration entries found in drizzle journal');
  }

  const baseline = [...journal.entries].sort((a, b) => a.idx - b.idx)[0]!;
  await db.execute(
    sql`insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values (${baseline.tag}, ${baseline.when})`,
  );

  console.log(`bootstrapped legacy schema into __drizzle_migrations with baseline ${baseline.tag}`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const db = createDatabase(databaseUrl);

  try {
    await bootstrapLegacyDatabase(db);

    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    const migrationsFolder = join(currentDir, '../drizzle');

    await migrate(db, { migrationsFolder });
    console.log('migrations applied successfully');
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
