import { describe, expect, it } from 'vitest';
import { getAllSources, getBatchSources, getSourceById, getWorkflowSources } from '../src/sources/catalog.js';

describe('source catalog', () => {
  it('returns known sources and enforces basic runtime policy invariants', () => {
    const sources = getAllSources();
    const ids = sources.map((source) => source.id);

    expect(ids).toContain('remoteok');
    expect(ids).toContain('weworkremotely');
    expect(ids).toContain('hh');
    expect(new Set(ids).size).toBe(ids.length);

    for (const source of sources) {
      expect(source.runtime.attempts).toBeGreaterThan(0);
      expect(source.runtime.backoffMs).toBeGreaterThan(0);
      expect(source.pool === 'light' || source.pool === 'heavy').toBe(true);
    }
  });

  it('splits batch/workflow sources and resolves by id', () => {
    const batchSources = getBatchSources();
    const workflowSources = getWorkflowSources();

    expect(batchSources.length).toBeGreaterThan(0);
    expect(workflowSources.length).toBeGreaterThan(0);
    expect(batchSources.every((source) => source.kind === 'batch')).toBe(true);
    expect(workflowSources.every((source) => source.kind === 'workflow')).toBe(true);

    const remoteok = getSourceById('remoteok');
    expect(remoteok.kind).toBe('batch');

    const hh = getSourceById('hh');
    expect(hh.kind).toBe('workflow');
  });

  it('throws for unknown source id', () => {
    expect(() => getSourceById('unknown')).toThrow('Unknown source id: unknown');
  });
});
