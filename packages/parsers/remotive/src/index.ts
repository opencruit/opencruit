import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_URL = 'https://remotive.com/api/remote-jobs';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 300];

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  company_logo: string;
  company_logo_url: string;
  category: string;
  tags: string[];
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
}

interface RemotiveResponse {
  jobs: RemotiveJob[];
  'job-count': number;
  'total-job-count': number;
}

/**
 * Parse Remotive salary string like "$120,000 - $170,000" or "$120 - $170 /hour".
 * Returns undefined if the string is empty or unparseable.
 */
function parseSalary(raw: string): RawJob['salary'] {
  if (!raw || !raw.trim()) return undefined;

  const match = raw.match(/\$?([\d,]+)\s*-\s*\$?([\d,]+)/);
  if (!match) return undefined;

  const min = Number(match[1]!.replaceAll(',', ''));
  const max = Number(match[2]!.replaceAll(',', ''));

  if (!Number.isFinite(min) && !Number.isFinite(max)) return undefined;

  return {
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
    currency: 'USD',
  };
}

function parseDate(dateRaw: string): Date | undefined {
  const parsed = new Date(dateRaw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toRawJob(job: RemotiveJob): RawJob {
  return {
    sourceId: 'remotive',
    externalId: `remotive:${job.id}`,
    url: job.url,
    title: job.title,
    company: job.company_name,
    companyLogoUrl: job.company_logo_url || job.company_logo || undefined,
    location: job.candidate_required_location || undefined,
    isRemote: true,
    description: job.description,
    tags: job.tags?.length > 0 ? job.tags : undefined,
    salary: parseSalary(job.salary),
    postedAt: parseDate(job.publication_date),
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

function isRemotiveJob(value: unknown): value is RemotiveJob {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === 'number' && typeof value.title === 'string' && typeof value.company_name === 'string';
}

function toRemotiveResponse(payload: unknown): RemotiveResponse {
  if (!isRecord(payload)) {
    throw new Error('Remotive API returned invalid payload');
  }

  const jobs = Array.isArray(payload.jobs) ? payload.jobs.filter(isRemotiveJob) : [];
  const jobCount = typeof payload['job-count'] === 'number' ? payload['job-count'] : jobs.length;
  const totalJobCount = typeof payload['total-job-count'] === 'number' ? payload['total-job-count'] : jobCount;

  return {
    jobs,
    'job-count': jobCount,
    'total-job-count': totalJobCount,
  };
}

async function fetchRemotive(): Promise<RemotiveResponse> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;

    try {
      res = await fetch(API_URL, {
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
      const statusError = new Error(`Remotive API returned ${res.status}`);
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
      return toRemotiveResponse(payload);
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(`Remotive API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Remotive API request failed after ${MAX_ATTEMPTS} attempts`);
}

export async function parse(): Promise<ParseResult> {
  const data = await fetchRemotive();

  const jobs = (data.jobs ?? []).filter((job) => job.title && job.company_name).map(toRawJob);

  return { jobs };
}

export const remotiveParser = defineParser({
  manifest: {
    id: 'remotive',
    name: 'Remotive',
    version: '0.1.0',
    schedule: '0 */4 * * *',
  },
  parse,
});
