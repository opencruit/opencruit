import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_URL = 'https://jobicy.com/api/v2/remote-jobs';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 300];
const MAX_COUNT = 50;

interface JobicyJob {
  id: number;
  url: string;
  jobSlug: string;
  jobTitle: string;
  companyName: string;
  companyLogo: string;
  jobIndustry: string[];
  jobType: string[];
  jobGeo: string;
  jobLevel: string;
  jobExcerpt: string;
  jobDescription: string;
  pubDate: string;
}

interface JobicyResponse {
  jobs: JobicyJob[];
  jobCount: number;
  success: boolean;
}

function parseDate(dateRaw: string): Date | undefined {
  const parsed = new Date(dateRaw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toRawJob(job: JobicyJob): RawJob {
  const tags = [...(job.jobIndustry ?? []), ...(job.jobType ?? [])].filter(Boolean);

  return {
    sourceId: 'jobicy',
    externalId: `jobicy:${job.id}`,
    url: job.url,
    title: job.jobTitle,
    company: job.companyName,
    companyLogoUrl: job.companyLogo || undefined,
    location: job.jobGeo || undefined,
    isRemote: true,
    description: job.jobDescription,
    tags: tags.length > 0 ? tags : undefined,
    postedAt: parseDate(job.pubDate),
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

function isJobicyJob(value: unknown): value is JobicyJob {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === 'number' && typeof value.jobTitle === 'string' && typeof value.companyName === 'string';
}

function toJobicyResponse(payload: unknown): JobicyResponse {
  if (!isRecord(payload)) {
    throw new Error('Jobicy API returned invalid payload');
  }

  const jobs = Array.isArray(payload.jobs) ? payload.jobs.filter(isJobicyJob) : [];
  const jobCount = typeof payload.jobCount === 'number' ? payload.jobCount : jobs.length;
  const success = payload.success === true;

  return { jobs, jobCount, success };
}

async function fetchJobicy(): Promise<JobicyResponse> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;

    try {
      res = await fetch(`${API_URL}?count=${MAX_COUNT}`, {
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
      const statusError = new Error(`Jobicy API returned ${res.status}`);
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
      return toJobicyResponse(payload);
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(`Jobicy API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Jobicy API request failed after ${MAX_ATTEMPTS} attempts`);
}

export async function parse(): Promise<ParseResult> {
  const data = await fetchJobicy();
  if (!data.success) {
    throw new Error('Jobicy API returned unsuccessful response');
  }

  const jobs = (data.jobs ?? []).filter((job) => job.jobTitle && job.companyName).map(toRawJob);

  return { jobs };
}

export const jobicyParser = defineParser({
  manifest: {
    id: 'jobicy',
    name: 'Jobicy',
    version: '0.1.0',
    schedule: '0 */6 * * *',
  },
  parse,
});
