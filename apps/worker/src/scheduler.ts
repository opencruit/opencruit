import type { HhClient } from '@opencruit/parser-hh';
import type { HhQueues } from './queues.js';

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
}

export interface SchedulerResult {
  roleCount: number;
}

function bootstrapKey(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

export async function scheduleHhJobs(
  queues: HhQueues,
  client: HhClient,
  options: SchedulerOptions = {},
): Promise<SchedulerResult> {
  const indexCron = options.indexCron ?? INDEX_CRON;
  const refreshCron = options.refreshCron ?? REFRESH_CRON;
  const gcArchiveCron = options.gcArchiveCron ?? GC_ARCHIVE_CRON;
  const gcDeleteCron = options.gcDeleteCron ?? GC_DELETE_CRON;
  const refreshBatchSize = options.refreshBatchSize ?? 500;

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
          pattern: indexCron,
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

  if (options.bootstrapIndexNow ?? true) {
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
      batchSize: refreshBatchSize,
    },
    {
      jobId: 'hh-refresh',
      repeat: {
        pattern: refreshCron,
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

  await queues.gcQueue.add(
    'hh-gc-archive',
    {
      mode: 'archive',
    },
    {
      jobId: 'hh-gc-archive',
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

  await queues.gcQueue.add(
    'hh-gc-delete',
    {
      mode: 'delete',
    },
    {
      jobId: 'hh-gc-delete',
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

  return {
    roleCount: roleIds.length,
  };
}
