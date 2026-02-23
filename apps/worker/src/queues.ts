import { Queue } from 'bullmq';
import type IORedis from 'ioredis';

export const HH_INDEX_QUEUE = 'hh.index';
export const HH_HYDRATE_QUEUE = 'hh.hydrate';
export const HH_REFRESH_QUEUE = 'hh.refresh';
export const HH_GC_QUEUE = 'hh.gc';

export interface HhIndexJobData {
  professionalRole: string;
  dateFromIso?: string;
  dateToIso?: string;
  depth?: number;
}

export interface HhHydrateJobData {
  vacancyId: string;
  reason: 'new' | 'refresh' | 'retry';
}

export interface HhRefreshJobData {
  batchSize?: number;
}

export interface HhGcJobData {
  mode: 'archive' | 'delete';
}

export interface HhQueues {
  indexQueue: Queue<HhIndexJobData>;
  hydrateQueue: Queue<HhHydrateJobData>;
  refreshQueue: Queue<HhRefreshJobData>;
  gcQueue: Queue<HhGcJobData>;
}

export function createHhQueues(connection: IORedis): HhQueues {
  return {
    indexQueue: new Queue<HhIndexJobData>(HH_INDEX_QUEUE, { connection }),
    hydrateQueue: new Queue<HhHydrateJobData>(HH_HYDRATE_QUEUE, { connection }),
    refreshQueue: new Queue<HhRefreshJobData>(HH_REFRESH_QUEUE, { connection }),
    gcQueue: new Queue<HhGcJobData>(HH_GC_QUEUE, { connection }),
  };
}
