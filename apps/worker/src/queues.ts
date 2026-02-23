import { Queue } from 'bullmq';
import type IORedis from 'ioredis';

export const SOURCE_INGEST_QUEUE = 'source.ingest';
export const HH_INDEX_QUEUE = 'hh.index';
export const HH_HYDRATE_QUEUE = 'hh.hydrate';
export const HH_REFRESH_QUEUE = 'hh.refresh';
export const SOURCE_GC_QUEUE = 'source.gc';

export interface SourceIngestJobData {
  sourceId: string;
  traceId?: string;
}

export interface HhIndexJobData {
  professionalRole: string;
  dateFromIso?: string;
  dateToIso?: string;
  depth?: number;
  traceId?: string;
}

export interface HhHydrateJobData {
  vacancyId: string;
  reason: 'new' | 'refresh' | 'retry';
  traceId?: string;
}

export interface HhRefreshJobData {
  batchSize?: number;
  traceId?: string;
}

export interface SourceGcJobData {
  mode: 'archive' | 'delete';
  sourceId?: string;
  traceId?: string;
}

export interface Queues {
  sourceIngestQueue: Queue<SourceIngestJobData>;
  indexQueue: Queue<HhIndexJobData>;
  hydrateQueue: Queue<HhHydrateJobData>;
  refreshQueue: Queue<HhRefreshJobData>;
  sourceGcQueue: Queue<SourceGcJobData>;
}

export function createQueues(connection: IORedis): Queues {
  return {
    sourceIngestQueue: new Queue<SourceIngestJobData>(SOURCE_INGEST_QUEUE, { connection }),
    indexQueue: new Queue<HhIndexJobData>(HH_INDEX_QUEUE, { connection }),
    hydrateQueue: new Queue<HhHydrateJobData>(HH_HYDRATE_QUEUE, { connection }),
    refreshQueue: new Queue<HhRefreshJobData>(HH_REFRESH_QUEUE, { connection }),
    sourceGcQueue: new Queue<SourceGcJobData>(SOURCE_GC_QUEUE, { connection }),
  };
}
