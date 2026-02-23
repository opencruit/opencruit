import { describe, it, expect } from 'vitest';
import { buildSegmentKey, createTimeSliceWindow, shouldSplit, splitTimeSlice } from '../src/segments.js';

describe('HH segments', () => {
  it('detects when search results require split', () => {
    expect(shouldSplit(2000)).toBe(false);
    expect(shouldSplit(2001)).toBe(true);
  });

  it('splits time window into two sub-slices', () => {
    const slice = {
      dateFromIso: '2026-02-23T00:00:00.000Z',
      dateToIso: '2026-02-23T04:00:00.000Z',
    };

    const [left, right] = splitTimeSlice(slice);

    expect(left.dateFromIso).toBe('2026-02-23T00:00:00.000Z');
    expect(left.dateToIso).toBe('2026-02-23T02:00:00.000Z');
    expect(right.dateFromIso).toBe('2026-02-23T02:00:00.000Z');
    expect(right.dateToIso).toBe('2026-02-23T04:00:00.000Z');
  });

  it('creates deterministic segment keys', () => {
    const slice = createTimeSliceWindow(new Date('2026-02-23T04:00:00.000Z'), 30);
    const key = buildSegmentKey('96', slice);

    expect(key).toBe('role:96:2026-02-23T03:30:00.000Z:2026-02-23T04:00:00.000Z');
  });
});
