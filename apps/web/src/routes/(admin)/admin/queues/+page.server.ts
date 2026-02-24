import type { Actions, PageServerLoad } from './$types';
import { getAllQueues, getQueue, QUEUE_NAMES, type QueueName } from '$lib/server/queues.js';
import { fail } from '@sveltejs/kit';

const QUEUE_STATES = ['wait', 'active', 'delayed', 'completed', 'failed', 'paused'] as const;

const QUEUE_LABELS: Record<QueueName, string> = {
  'source.ingest': 'Source Ingest',
  'hh.index': 'HH Index',
  'hh.hydrate': 'HH Hydrate',
  'hh.refresh': 'HH Refresh',
  'source.gc': 'Source GC',
};

interface FailedJobInfo {
  id: string;
  name: string;
  data: string;
  failedReason: string;
  timestamp: number;
  attemptsMade: number;
}

export const load: PageServerLoad = async ({ url }) => {
  const requestedTab = url.searchParams.get('tab');
  const activeTab = requestedTab && isValidQueueName(requestedTab) ? requestedTab : 'source.ingest';

  const allQueues = getAllQueues();
  if (!allQueues) {
    return { queues: null, activeTab };
  }

  const queueData: Array<{
    name: QueueName;
    label: string;
    counts: Record<string, number>;
    failedJobs: FailedJobInfo[];
  }> = [];

  for (const { name, queue } of allQueues) {
    const counts = (await queue.getJobCounts(...QUEUE_STATES)) as Record<string, number>;

    let failedJobs: FailedJobInfo[] = [];
    if (name === activeTab) {
      const failed = await queue.getFailed(0, 29);
      failedJobs = failed.map((job) => ({
        id: job.id ?? '',
        name: job.name,
        data: JSON.stringify(job.data, null, 2).slice(0, 500),
        failedReason: job.failedReason ?? 'unknown',
        timestamp: job.timestamp ?? 0,
        attemptsMade: job.attemptsMade,
      }));
    }

    queueData.push({ name, label: QUEUE_LABELS[name], counts, failedJobs });
  }

  return { queues: queueData, activeTab };
};

function isValidQueueName(name: string): name is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(name);
}

export const actions: Actions = {
  retryJob: async ({ request }) => {
    const formData = await request.formData();
    const queueName = String(formData.get('queue') ?? '');
    const jobId = String(formData.get('jobId') ?? '');

    if (!isValidQueueName(queueName)) return fail(400, { error: 'Invalid queue' });
    if (!jobId) return fail(400, { error: 'Invalid job ID' });

    const queue = getQueue(queueName);
    if (!queue) return fail(503, { error: 'Redis not connected' });
    const job = await queue.getJob(jobId);
    if (!job) return fail(404, { error: 'Job not found' });

    await job.retry();
    return { retried: jobId };
  },

  removeJob: async ({ request }) => {
    const formData = await request.formData();
    const queueName = String(formData.get('queue') ?? '');
    const jobId = String(formData.get('jobId') ?? '');

    if (!isValidQueueName(queueName)) return fail(400, { error: 'Invalid queue' });
    if (!jobId) return fail(400, { error: 'Invalid job ID' });

    const queue = getQueue(queueName);
    if (!queue) return fail(503, { error: 'Redis not connected' });
    const job = await queue.getJob(jobId);
    if (!job) return fail(404, { error: 'Job not found' });

    await job.remove();
    return { removed: jobId };
  },

  cleanFailed: async ({ request }) => {
    const formData = await request.formData();
    const queueName = String(formData.get('queue') ?? '');

    if (!isValidQueueName(queueName)) return fail(400, { error: 'Invalid queue' });

    const queue = getQueue(queueName);
    if (!queue) return fail(503, { error: 'Redis not connected' });
    await queue.clean(0, 1000, 'failed');
    return { cleaned: queueName };
  },
};
