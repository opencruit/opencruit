import { describe, expect, it } from 'vitest';
import { ensureTraceId } from '../../src/observability/trace.js';

describe('ensureTraceId', () => {
  it('returns existing trace id as-is', () => {
    expect(ensureTraceId('trace-123')).toBe('trace-123');
  });

  it('creates a trace id when value is missing', () => {
    const traceId = ensureTraceId();

    expect(traceId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('creates a trace id when value is empty', () => {
    const traceId = ensureTraceId('   ');

    expect(traceId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
