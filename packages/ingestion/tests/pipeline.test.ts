import { describe, it, expect, vi } from 'vitest';
import type { Database } from '@opencruit/db';
import type { Parser } from '@opencruit/parser-sdk';
import { ingest } from '../src/pipeline.js';

function createDbMock(existingRows: Array<{ fingerprint: string; sourceId: string; id: string }> = []) {
  const orderBy = vi.fn().mockResolvedValue(existingRows);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { select, insert } as unknown as Database,
    select,
    orderBy,
    where,
    insert,
    values,
    onConflictDoUpdate,
  };
}

function createParser(id: string, parse: Parser['parse']): Parser {
  return {
    manifest: {
      id,
      name: id,
      version: '0.1.0',
      schedule: '0 * * * *',
    },
    parse,
  };
}

describe('ingest pipeline', () => {
  it('processes a valid parser and stores jobs', async () => {
    const { db, insert, values } = createDbMock();
    const parser = createParser('source-a', async () => ({
      jobs: [
        {
          sourceId: 'source-a',
          externalId: 'source-a:1',
          url: 'https://example.com/jobs/1',
          title: 'Engineer',
          company: 'Acme',
          description: 'Great role',
        },
      ],
    }));

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = await ingest([parser], { db, logger });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(result.totalErrors).toBe(0);
    expect(result.totalStored).toBe(1);
    expect(result.parsers[0]!.stats.parsed).toBe(1);
    expect(result.parsers[0]!.stats.validated).toBe(1);
    expect(result.parsers[0]!.stats.upserted).toBe(1);
  });

  it('continues processing when one parser fails', async () => {
    const { db } = createDbMock();
    const failing = createParser('failing', async () => {
      throw new Error('boom');
    });
    const succeeding = createParser('succeeding', async () => ({ jobs: [] }));

    const result = await ingest([failing, succeeding], { db });

    expect(result.parsers).toHaveLength(2);
    expect(result.totalErrors).toBe(1);
    expect(result.parsers[0]!.errors[0]).toContain('boom');
    expect(result.parsers[1]!.errors).toHaveLength(0);
  });

  it('reports validation drops for invalid jobs', async () => {
    const { db, insert } = createDbMock();
    const parser = createParser('invalid-source', async () => ({
      jobs: [
        {
          sourceId: 'invalid-source',
          externalId: 'invalid-source:1',
          url: 'not-a-url',
          title: 'Engineer',
          company: 'Acme',
          description: 'Great role',
        },
      ],
    }));

    const result = await ingest([parser], { db });

    expect(insert).not.toHaveBeenCalled();
    expect(result.parsers[0]!.stats.parsed).toBe(1);
    expect(result.parsers[0]!.stats.validated).toBe(0);
    expect(result.parsers[0]!.stats.validationDropped).toBe(1);
    expect(result.parsers[0]!.stats.upserted).toBe(0);
  });
});
