import type { Job } from 'bullmq';
import { ensureTraceId } from './trace.js';

interface TraceableData {
  traceId?: string;
}

export function withTrace<TData extends TraceableData>(job: Job<TData>): string {
  const traceId = ensureTraceId(job.data.traceId);
  job.data.traceId = traceId;
  return traceId;
}
