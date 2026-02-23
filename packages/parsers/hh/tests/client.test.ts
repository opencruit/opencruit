import { describe, expect, it, vi } from 'vitest';
import { HhCircuitOpenError, HhClient, HhHttpError } from '../src/client.js';
import type { HhSearchResponse } from '../src/types.js';

const okSearchResponse: HhSearchResponse = {
  items: [],
  found: 0,
  pages: 0,
  page: 0,
  per_page: 100,
};

describe('HH client', () => {
  it('sets Authorization header when access token is provided', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okSearchResponse), { status: 200 }));

    const client = new HhClient({
      userAgent: 'OpenCruit-Test/1.0',
      accessToken: 'test-token',
      minDelayMs: 0,
      maxDelayMs: 0,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.searchVacancies({ professionalRole: '96' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls.at(0) as unknown[] | undefined;
    expect(call).toBeTruthy();

    const init = call?.[1] as { headers?: Record<string, string> } | undefined;
    const headers = init?.headers;
    expect(headers?.Authorization).toBe('Bearer test-token');
    expect(headers?.['HH-User-Agent']).toBe('OpenCruit-Test/1.0');
  });

  it('retries request on 429 with retry-after support', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ type: 'too_many_requests' }] }), {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(okSearchResponse), { status: 200 }));

    const client = new HhClient({
      userAgent: 'OpenCruit-Test/1.0',
      minDelayMs: 0,
      maxDelayMs: 0,
      maxRetries: 2,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.searchVacancies({ professionalRole: '96' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.items).toEqual([]);
  });

  it('opens circuit after repeated failures', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'too many requests' }), { status: 429 }));

    const client = new HhClient({
      userAgent: 'OpenCruit-Test/1.0',
      minDelayMs: 0,
      maxDelayMs: 0,
      maxRetries: 0,
      circuitFailureThreshold: 1,
      circuitOpenMs: 60_000,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.searchVacancies({ professionalRole: '96' })).rejects.toBeInstanceOf(HhHttpError);
    await expect(client.searchVacancies({ professionalRole: '96' })).rejects.toBeInstanceOf(HhCircuitOpenError);
  });
});
