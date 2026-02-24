import IORedis from 'ioredis';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';

function createRedisConnection(): IORedis | null {
  if (building) return null;
  const url = env.REDIS_URL;
  if (!url) return null;
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

const globalForRedis = globalThis as { __opencruit_redis?: IORedis | null };

export const redis = (globalForRedis.__opencruit_redis ??= createRedisConnection());
export const redisAvailable = redis !== null;
