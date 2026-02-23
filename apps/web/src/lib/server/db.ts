import { createDatabase } from '@opencruit/db';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';

if (!building && !env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const db = building ? undefined! : createDatabase(env.DATABASE_URL!);
