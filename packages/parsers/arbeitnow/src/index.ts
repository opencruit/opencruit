import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_URL = 'https://arbeitnow.com/api/job-board-api';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 300];
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 50;

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
}

interface ArbeitnowMeta {
  per_page?: number;
}

interface ArbeitnowResponse {
  data: ArbeitnowJob[];
  meta?: ArbeitnowMeta;
}

function parseDateFromEpoch(epochSeconds: number): Date | undefined {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return undefined;
  }

  const parsed = new Date(epochSeconds * 1000);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toRawJob(job: ArbeitnowJob): RawJob {
  return {
    sourceId: 'arbeitnow',
    externalId: `arbeitnow:${job.slug}`,
    url: job.url,
    title: job.title,
    company: job.company_name,
    location: job.location || undefined,
    isRemote: job.remote,
    description: job.description,
    tags: job.tags?.length > 0 ? [...job.tags, ...(job.job_types ?? [])] : job.job_types?.length > 0 ? job.job_types : undefined,
    postedAt: parseDateFromEpoch(job.created_at),
    applyUrl: job.url,
    raw: job as unknown as Record<string, unknown>,
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isArbeitnowJob(value: unknown): value is ArbeitnowJob {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.slug === 'string' &&
    typeof value.company_name === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    typeof value.remote === 'boolean' &&
    typeof value.url === 'string' &&
    Array.isArray(value.tags) &&
    Array.isArray(value.job_types) &&
    typeof value.location === 'string' &&
    typeof value.created_at === 'number'
  );
}

function toArbeitnowResponse(payload: unknown): ArbeitnowResponse {
  if (!isRecord(payload)) {
    throw new Error('Arbeitnow API returned invalid payload');
  }

  const dataRaw = payload.data;
  if (!Array.isArray(dataRaw)) {
    throw new Error('Arbeitnow API returned invalid jobs payload');
  }

  const data = dataRaw.filter(isArbeitnowJob);
  const meta = isRecord(payload.meta) ? { per_page: typeof payload.meta.per_page === 'number' ? payload.meta.per_page : undefined } : undefined;

  return { data, meta };
}

async function fetchArbeitnowPage(page: number): Promise<ArbeitnowResponse> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;

    try {
      res = await fetch(`${API_URL}?page=${page}`, {
        headers: { 'User-Agent': 'OpenCruit/0.1 (+https://github.com/opencruit/opencruit)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
      continue;
    }

    if (!res.ok) {
      const statusError = new Error(`Arbeitnow API returned ${res.status}`);
      if (!shouldRetryStatus(res.status)) {
        throw statusError;
      }

      lastError = statusError;
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
      continue;
    }

    try {
      const payload = await res.json();
      return toArbeitnowResponse(payload);
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(`Arbeitnow API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Arbeitnow API request failed after ${MAX_ATTEMPTS} attempts`);
}

export async function parse(): Promise<ParseResult> {
  const allJobs: RawJob[] = [];
  const seenExternalIds = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    let data: ArbeitnowResponse;
    try {
      data = await fetchArbeitnowPage(page);
    } catch (error) {
      if (page > 1 && error instanceof Error && error.message.includes('429')) {
        break;
      }

      throw error;
    }

    const pageJobs = data.data.filter((job) => job.title && job.company_name).map(toRawJob);
    for (const job of pageJobs) {
      if (seenExternalIds.has(job.externalId)) {
        continue;
      }

      seenExternalIds.add(job.externalId);
      allJobs.push(job);
    }

    const pageSize = data.meta?.per_page && data.meta.per_page > 0 ? data.meta.per_page : DEFAULT_PAGE_SIZE;
    if (data.data.length === 0 || data.data.length < pageSize) {
      break;
    }
  }

  return { jobs: allJobs };
}

export const arbeitnowParser = defineParser({
  manifest: {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    version: '0.1.0',
    schedule: '0 */6 * * *',
  },
  parse,
});
