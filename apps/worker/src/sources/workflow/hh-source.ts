import { HhClient } from '@opencruit/parser-hh';
import { defineSource } from '../define-source.js';

function bootstrapKey(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

const HH_RUNTIME = {
  attempts: 4,
  backoffMs: 5000,
} as const;

function resolveHhClient(services: Record<string, unknown>): HhClient {
  const client = services.hhClient;
  if (!client || typeof client !== 'object' || !('getItRoleIds' in client)) {
    throw new Error('Workflow services missing hhClient');
  }

  return client as HhClient;
}

export const hhSource = defineSource({
  id: 'hh',
  kind: 'workflow',
  pool: 'light',
  runtime: HH_RUNTIME,
  async setupScheduler({ queues, services, options }) {
    const hhClient = resolveHhClient(services);
    const roleIds = await hhClient.getItRoleIds();
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
          attempts: HH_RUNTIME.attempts,
          backoff: {
            type: 'exponential',
            delay: HH_RUNTIME.backoffMs,
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
            attempts: HH_RUNTIME.attempts,
            backoff: {
              type: 'exponential',
              delay: HH_RUNTIME.backoffMs,
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
        attempts: HH_RUNTIME.attempts,
        backoff: {
          type: 'exponential',
          delay: HH_RUNTIME.backoffMs,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );

    return {
      stats: {
        roleCount: roleIds.length,
      },
    };
  },
});
