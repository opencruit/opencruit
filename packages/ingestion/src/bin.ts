import { createDatabase } from '@opencruit/db';
import { remoteOKParser } from '@opencruit/parser-remoteok';
import { weWorkRemotelyParser } from '@opencruit/parser-weworkremotely';
import type { Parser } from '@opencruit/parser-sdk';
import { ingest } from './pipeline.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const db = createDatabase(databaseUrl);
const parsers: Parser[] = [remoteOKParser, weWorkRemotelyParser];

const result = await ingest(parsers, { db });
process.exit(result.totalErrors > 0 ? 1 : 0);
