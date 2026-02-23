import { createDatabase } from '../../packages/db/src/client.ts';
import { sql } from 'drizzle-orm';

function printRow(label: string, value: string | number | null | undefined): void {
  console.log(`${label}: ${value ?? '-'}`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const db = createDatabase(databaseUrl);

  try {
    const totalResult = await db.execute(sql`select count(*)::int as count from jobs`);
    const totalCount = Number(totalResult[0]?.count ?? 0);

    console.log('=== jobs ===');
    printRow('total', totalCount);

    const bySource = await db.execute(sql`
      select source_id, count(*)::int as count
      from jobs
      group by source_id
      order by source_id asc
    `);

    for (const row of bySource) {
      printRow(String(row.source_id), Number(row.count ?? 0));
    }

    console.log('=== source_health ===');
    try {
      const healthRows = await db.execute(sql`
        select
          source_id,
          stage,
          status,
          consecutive_failures,
          last_success_at,
          last_error_at,
          updated_at
        from source_health
        order by source_id asc, stage asc
      `);

      if (healthRows.length === 0) {
        console.log('no rows');
      }

      for (const row of healthRows) {
        const line = [
          `${String(row.source_id)}/${String(row.stage)}`,
          `status=${String(row.status)}`,
          `fails=${Number(row.consecutive_failures ?? 0)}`,
          `last_success=${String(row.last_success_at ?? '-')}`,
          `last_error=${String(row.last_error_at ?? '-')}`,
          `updated_at=${String(row.updated_at ?? '-')}`,
        ].join(' ');

        console.log(line);
      }
    } catch (error) {
      console.log('source_health unavailable:', error instanceof Error ? error.message : String(error));
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
