import { Queue } from 'bullmq';
import { redis, redisAvailable } from './redis.js';

export const QUEUE_NAMES = [
  'source.ingest',
  'hh.index',
  'hh.hydrate',
  'hh.refresh',
  'source.gc',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export interface SourceIngestJobData {
  sourceId: string;
  traceId?: string;
}

export interface SourceGcJobData {
  mode: 'archive' | 'delete';
  sourceId?: string;
  traceId?: string;
}

export { redisAvailable as queuesAvailable };

const globalForQueues = globalThis as { __opencruit_queues?: Map<QueueName, Queue> };

function getQueueMap(): Map<QueueName, Queue> | null {
  if (!redisAvailable || !redis) return null;
  if (!globalForQueues.__opencruit_queues) {
    const map = new Map<QueueName, Queue>();
    for (const name of QUEUE_NAMES) {
      map.set(name, new Queue(name, { connection: redis }));
    }
    globalForQueues.__opencruit_queues = map;
  }
  return globalForQueues.__opencruit_queues;
}

export function getQueue(name: QueueName): Queue | null {
  return getQueueMap()?.get(name) ?? null;
}

export function getAllQueues(): Array<{ name: QueueName; queue: Queue }> | null {
  const map = getQueueMap();
  if (!map) return null;
  return QUEUE_NAMES.map((name) => ({ name, queue: map.get(name)! }));
}
