import type { HhClient } from '@opencruit/parser-hh';
import { getAllParsers } from './registry.js';
import type { Queues } from './queues.js';

const INDEX_CRON = '15 */12 * * *';
const REFRESH_CRON = '0 */12 * * *';
const GC_ARCHIVE_CRON = '0 3 */3 * *';
const GC_DELETE_CRON = '0 4 * * 1';
const SOURCE_INGEST_BACKOFF_MS = 5000;

export interface SchedulerOptions {
  indexCron?: string;
  refreshCron?: string;
  gcArchiveCron?: string;
  gcDeleteCron?: string;
  bootstrapIndexNow?: boolean;
  refreshBatchSize?: number;
  parserSchedules?: Record<string, string>;
}

export interface SchedulerResult {
  roleCount: number;
  batchParserCount: number;
  hhSchedulingSucceeded: boolean;
  hhError?: string;
}

function bootstrapKey(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function parserScheduleEnvKey(parserId: string): string {
  return `PARSER_SCHEDULE_${parserId.replaceAll(/[^a-z0-9]/gi, '_').toUpperCase()}`;
}

function resolveParserSchedule(
  parserId: string,
  manifestSchedule: string,
  parserSchedules: Record<string, string> | undefined,
): string {
  const configOverride = parserSchedules?.[parserId]?.trim();
  if (configOverride) {
    return configOverride;
  }

  const envOverride = process.env[parserScheduleEnvKey(parserId)]?.trim();
  if (envOverride) {
    return envOverride;
  }

  return manifestSchedule;
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

async function scheduleHhJobs(
  queues: Queues,
  client: HhClient,
  options: {
    indexCron: string;
    refreshCron: string;
    refreshBatchSize: number;
    bootstrapIndexNow: boolean;
  },
): Promise<number> {
  const roleIds = await client.getItRoleIds();
  if (roleIds.length === 0) {
    throw new Error('HH API returned no IT professional roles');
  }

  for (const roleId of roleIds) {
    await queues.indexQueue.add(
      'hh-index',
      {
        professionalRole: roleId,
      },
      {
        jobId: `hh-index-role-${roleId}`,
        repeat: {
          pattern: options.indexCron,
        },
        attempts: 4,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  if (options.bootstrapIndexNow) {
    const key = bootstrapKey(new Date());
    for (const roleId of roleIds) {
      await queues.indexQueue.add(
        'hh-index-bootstrap',
        {
          professionalRole: roleId,
        },
        {
          jobId: `hh-index-bootstrap-${roleId}-${key}`,
          attempts: 4,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      );
    }
  }

  await queues.refreshQueue.add(
    'hh-refresh',
    {
      batchSize: options.refreshBatchSize,
    },
    {
      jobId: 'hh-refresh',
      repeat: {
        pattern: options.refreshCron,
      },
      attempts: 4,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: 1000,
    },
  );

  return roleIds.length;
}

export async function scheduleAllSources(
  queues: Queues,
  client: HhClient,
  options: SchedulerOptions = {},
): Promise<SchedulerResult> {
  const indexCron = options.indexCron ?? INDEX_CRON;
  const refreshCron = options.refreshCron ?? REFRESH_CRON;
  const gcArchiveCron = options.gcArchiveCron ?? GC_ARCHIVE_CRON;
  const gcDeleteCron = options.gcDeleteCron ?? GC_DELETE_CRON;
  const refreshBatchSize = options.refreshBatchSize ?? 500;
  const parsers = getAllParsers();

  for (const parser of parsers) {
    const parserId = parser.manifest.id;
    const schedule = resolveParserSchedule(parserId, parser.manifest.schedule, options.parserSchedules);

    await queues.sourceIngestQueue.add(
      'source-ingest',
      {
        parserId,
      },
      {
        jobId: `source-ingest-${parserId}`,
        repeat: {
          pattern: schedule,
        },
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: SOURCE_INGEST_BACKOFF_MS,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  await scheduleSourceGcJobs(queues, gcArchiveCron, gcDeleteCron);

  let roleCount = 0;
  let hhSchedulingSucceeded = true;
  let hhError: string | undefined;

  try {
    roleCount = await scheduleHhJobs(queues, client, {
      indexCron,
      refreshCron,
      refreshBatchSize,
      bootstrapIndexNow: options.bootstrapIndexNow ?? true,
    });
  } catch (error) {
    hhSchedulingSucceeded = false;
    hhError = error instanceof Error ? error.message : String(error);
  }

  return {
    roleCount,
    batchParserCount: parsers.length,
    hhSchedulingSucceeded,
    hhError,
  };
}
