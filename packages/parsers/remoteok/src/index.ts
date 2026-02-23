import type { Parser, ParseResult, RawJob } from '@opencruit/parser-sdk';

const API_URL = 'https://remoteok.com/api';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 300];

interface RemoteOKJob {
  id: string;
  slug: string;
  position: string;
  company: string;
  company_logo: string;
  location: string;
  tags: string[];
  description: string;
  salary_min: number;
  salary_max: number;
  apply_url: string;
  url: string;
  date: string;
  epoch: number;
}

function toRawJob(job: RemoteOKJob): RawJob {
  return {
    sourceId: 'remoteok',
    externalId: `remoteok:${job.id}`,
    url: job.url,
    title: job.position,
    company: job.company,
    companyLogoUrl: job.company_logo || undefined,
    location: job.location || undefined,
    isRemote: true,
    description: job.description,
    tags: job.tags,
    salary:
      job.salary_min > 0 || job.salary_max > 0
        ? { min: job.salary_min || undefined, max: job.salary_max || undefined, currency: 'USD' }
        : undefined,
    postedAt: new Date(job.date),
    applyUrl: job.apply_url || undefined,
    raw: job as unknown as Record<string, unknown>,
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRemoteOK(): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(API_URL, {
        headers: { 'User-Agent': 'OpenCruit/0.1 (+https://github.com/opencruit/opencruit)' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.ok) return res;

      const statusError = new Error(`RemoteOK API returned ${res.status}`);
      if (!shouldRetryStatus(res.status)) {
        throw statusError;
      }

      lastError = statusError;
    } catch (error) {
      if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error(String(error));
      }
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
      await sleep(delay);
    }
  }

  throw lastError ?? new Error(`RemoteOK API request failed after ${MAX_ATTEMPTS} attempts`);
}

export async function parse(): Promise<ParseResult> {
  const res = await fetchRemoteOK();

  const data = (await res.json()) as RemoteOKJob[];

  // First element is a legal notice, skip it
  // Filter out incomplete jobs (empty title or company)
  const jobs = data
    .slice(1)
    .filter((job) => job.position && job.company)
    .map(toRawJob);

  return { jobs };
}

export const remoteOKParser: Parser = {
  manifest: {
    id: 'remoteok',
    name: 'RemoteOK',
    version: '0.1.0',
    schedule: '0 */4 * * *',
  },
  parse,
};
