import { randomUUID } from 'node:crypto';

export function ensureTraceId(traceId?: string): string {
  if (traceId && traceId.trim().length > 0) {
    return traceId;
  }

  return randomUUID();
}
