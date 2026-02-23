import type { HhClient } from '@opencruit/parser-hh';
import { getBatchSources, getWorkflowSources } from './sources/catalog.js';
import type { BatchSourceDefinition } from './sources/types.js';
import type { Queues } from './queues.js';

const INDEX_CRON = '15 */12 * * *';
const REFRESH_CRON = '0 */12 * * *';
const GC_ARCHIVE_CRON = '0 3 */3 * *';
const GC_DELETE_CRON = '0 4 * * 1';

export interface SchedulerOptions {
  indexCron?: string;
  refreshCron?: string;
  gcArchiveCron?: string;
  gcDeleteCron?: string;
  bootstrapIndexNow?: boolean;
  refreshBatchSize?: number;
  sourceSchedules?: Record<string, string>;
}

export interface SchedulerResult {
  scheduledBatchSources: number;
  scheduledWorkflowSources: number;
  batchErrors: Array<{
    sourceId: string;
    error: string;
  }>;
  workflowErrors: Array<{
    sourceId: string;
    error: string;
  }>;
  workflowStats: Record<string, Record<string, number | string | boolean>>;
}

function sourceScheduleEnvKey(sourceId: string): string {
  return `SOURCE_SCHEDULE_${sourceId.replaceAll(/[^a-z0-9]/gi, '_').toUpperCase()}`;
}

function resolveSourceSchedule(
  source: BatchSourceDefinition,
  sourceSchedules: Record<string, string> | undefined,
): string {
  const configOverride = sourceSchedules?.[source.id]?.trim();
  if (configOverride) {
    return configOverride;
  }

  const envOverride = process.env[sourceScheduleEnvKey(source.id)]?.trim();
  if (envOverride) {
    return envOverride;
  }

  const declared = source.schedule?.trim();
  if (declared) {
    return declared;
  }

  const manifestSchedule = source.parser.manifest.schedule.trim();
  if (manifestSchedule) {
    return manifestSchedule;
  }

  throw new Error(`Source ${source.id} has no schedule configured`);
}

async function scheduleSourceGcJobs(queues: Queues, gcArchiveCron: string, gcDeleteCron: string): Promise<void> {
  await queues.sourceGcQueue.add(
    'source-gc-archive',
    {
      mode: 'archive',
    },
    {
      jobId: 'source-gc-archive',
      repeat: {
        pattern: gcArchiveCron,
      },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  );

  await queues.sourceGcQueue.add(
    'source-gc-delete',
    {
      mode: 'delete',
    },
    {
      jobId: 'source-gc-delete',
      repeat: {
        pattern: gcDeleteCron,
      },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  );
}

export async function scheduleAllSources(
  queues: Queues,
  hhClient: HhClient,
  options: SchedulerOptions = {},
): Promise<SchedulerResult> {
  const indexCron = options.indexCron ?? INDEX_CRON;
  const refreshCron = options.refreshCron ?? REFRESH_CRON;
  const gcArchiveCron = options.gcArchiveCron ?? GC_ARCHIVE_CRON;
  const gcDeleteCron = options.gcDeleteCron ?? GC_DELETE_CRON;
  const refreshBatchSize = options.refreshBatchSize ?? 500;
  const batchSources = getBatchSources();
  const workflowSources = getWorkflowSources();
  let scheduledBatchSources = 0;
  const batchErrors: Array<{ sourceId: string; error: string }> = [];

  for (const source of batchSources) {
    try {
      const schedule = resolveSourceSchedule(source, options.sourceSchedules);

      await queues.sourceIngestQueue.add(
        'source-ingest',
        {
          sourceId: source.id,
        },
        {
          jobId: `source-ingest-${source.id}`,
          repeat: {
            pattern: schedule,
          },
          attempts: source.runtime.attempts,
          backoff: {
            type: 'exponential',
            delay: source.runtime.backoffMs,
          },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
      scheduledBatchSources += 1;
    } catch (error) {
      batchErrors.push({
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await scheduleSourceGcJobs(queues, gcArchiveCron, gcDeleteCron);

  let scheduledWorkflowSources = 0;
  const workflowErrors: Array<{ sourceId: string; error: string }> = [];
  const workflowStats: Record<string, Record<string, number | string | boolean>> = {};

  for (const source of workflowSources) {
    try {
      const result = await source.setupScheduler({
        queues,
        services: {
          hhClient,
        },
        options: {
          indexCron,
          refreshCron,
          refreshBatchSize,
          bootstrapIndexNow: options.bootstrapIndexNow ?? true,
        },
      });
      scheduledWorkflowSources += 1;
      if (result.stats) {
        workflowStats[source.id] = result.stats;
      }
    } catch (error) {
      workflowErrors.push({
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    scheduledBatchSources,
    scheduledWorkflowSources,
    batchErrors,
    workflowErrors,
    workflowStats,
  };
}
