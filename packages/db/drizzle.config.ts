import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../../');
const envPath = resolve(repoRoot, '.env');
const envLocalPath = resolve(repoRoot, '.env.local');

if (existsSync(envPath)) {
  config({ path: envPath });
}

if (existsSync(envLocalPath)) {
  config({ path: envLocalPath, override: true });
}

export default defineConfig({
  out: './drizzle',
  schema: './src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
