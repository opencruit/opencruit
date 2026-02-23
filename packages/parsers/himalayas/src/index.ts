import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_URL = 'https://himalayas.app/jobs/api';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [200, 500];
const REQUESTED_PAGE_SIZE = 100;
const MAX_PAGES = 50;

interface HimalayasJob {
  guid: string;
  title: string;
  excerpt: string;
  companyName: string;
  companyLogo: string;
  employmentType: string;
  minSalary: number | null;
  maxSalary: number | null;
  currency: string;
  seniority: string[];
  locationRestrictions: string[];
  timezoneRestrictions: number[];
  categories: string[];
  parentCategories: string[];
  description: string;
  pubDate: number;
  expiryDate: number;
  applicationLink: string;
}

interface HimalayasResponse {
  jobs: HimalayasJob[];
  totalCount: number;
  offset: number;
  limit: number;
}

function extractSlug(guid: string): string {
  try {
    const url = new URL(guid);
    return url.pathname.replace(/^\//, '').replace(/\/$/, '') || guid;
  } catch {
    return guid;
  }
}

function parseDateFromEpoch(epochSeconds: number): Date | undefined {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return undefined;
  }

  const parsed = new Date(epochSeconds * 1000);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toRawJob(job: HimalayasJob): RawJob {
  const tags = [...(job.categories ?? []), ...(job.parentCategories ?? [])].filter(Boolean);
  const location = (job.locationRestrictions ?? []).join(', ');

  const salary: RawJob['salary'] =
    job.minSalary !== null || job.maxSalary !== null
      ? {
          min: job.minSalary ?? undefined,
          max: job.maxSalary ?? undefined,
          currency: job.currency || undefined,
        }
      : undefined;

  return {
    sourceId: 'himalayas',
    externalId: `himalayas:${extractSlug(job.guid)}`,
    url: job.guid,
    title: job.title,
    company: job.companyName,
    companyLogoUrl: job.companyLogo || undefined,
    location: location || undefined,
    isRemote: true,
    description: job.description,
    tags: tags.length > 0 ? tags : undefined,
    salary,
    postedAt: parseDateFromEpoch(job.pubDate),
    applyUrl: job.applicationLink || job.guid,
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

function isHimalayasJob(value: unknown): value is HimalayasJob {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.guid === 'string' && typeof value.title === 'string' && typeof value.companyName === 'string';
}

function toHimalayasResponse(payload: unknown): HimalayasResponse {
  if (!isRecord(payload)) {
    throw new Error('Himalayas API returned invalid payload');
  }

  const jobsRaw = Array.isArray(payload.jobs) ? payload.jobs.filter(isHimalayasJob) : [];
  const totalCount = typeof payload.totalCount === 'number' && Number.isFinite(payload.totalCount) ? payload.totalCount : jobsRaw.length;
  const offset = typeof payload.offset === 'number' && Number.isFinite(payload.offset) ? payload.offset : 0;
  const limit =
    typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
      ? payload.limit
      : jobsRaw.length;

  return {
    jobs: jobsRaw,
    totalCount,
    offset,
    limit,
  };
}

async function fetchPage(offset: number): Promise<HimalayasResponse> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;

    try {
      const url = `${API_URL}?limit=${REQUESTED_PAGE_SIZE}&offset=${offset}`;
      res = await fetch(url, {
        headers: { 'User-Agent': 'OpenCruit/0.1 (+https://github.com/opencruit/opencruit)' },
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
      const statusError = new Error(`Himalayas API returned ${res.status}`);
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
      return toHimalayasResponse(payload);
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(`Himalayas API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Himalayas API request failed after ${MAX_ATTEMPTS} attempts`);
}

export async function parse(): Promise<ParseResult> {
  const allJobs: RawJob[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await fetchPage(offset);
    const pageJobs = (data.jobs ?? []).filter((job) => job.title && job.companyName).map(toRawJob);

    allJobs.push(...pageJobs);

    const effectiveLimit = data.limit > 0 ? data.limit : data.jobs.length || REQUESTED_PAGE_SIZE;
    const nextOffset = data.offset + effectiveLimit;
    if (data.jobs.length === 0 || data.jobs.length < effectiveLimit || nextOffset >= data.totalCount) {
      break;
    }

    offset = nextOffset;
  }

  return { jobs: allJobs };
}

export const himalayasParser = defineParser({
  manifest: {
    id: 'himalayas',
    name: 'Himalayas',
    version: '0.1.0',
    schedule: '0 */4 * * *',
  },
  parse,
});
