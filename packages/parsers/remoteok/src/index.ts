import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_URL = 'https://remoteok.com/api';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 300];

interface RemoteOKJob {
  id: string | number;
  position: string;
  company: string;
  company_logo?: string;
  location?: string;
  tags?: unknown;
  description?: string;
  salary_min?: number;
  salary_max?: number;
  apply_url?: string;
  url: string;
  date?: string;
  epoch?: number;
}

type JsonRecord = Record<string, unknown>;

function parseDate(dateRaw: string | undefined, epochRaw: number | undefined): Date | undefined {
  if (dateRaw) {
    const parsed = new Date(dateRaw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (typeof epochRaw === 'number' && Number.isFinite(epochRaw) && epochRaw > 0) {
    const parsed = new Date(epochRaw * 1000);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeTags(tagsRaw: unknown): string[] | undefined {
  if (!Array.isArray(tagsRaw)) {
    return undefined;
  }

  const tags = tagsRaw.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function normalizeLogoUrl(logoRaw: string | undefined): string | undefined {
  if (!logoRaw) {
    return undefined;
  }

  if (/^https?:\/\//i.test(logoRaw)) {
    return logoRaw;
  }

  if (logoRaw.startsWith('/')) {
    return `https://remoteok.com${logoRaw}`;
  }

  return undefined;
}

function toRawJob(job: RemoteOKJob, raw: JsonRecord): RawJob {
  const salaryMin = typeof job.salary_min === 'number' && Number.isFinite(job.salary_min) ? job.salary_min : undefined;
  const salaryMax = typeof job.salary_max === 'number' && Number.isFinite(job.salary_max) ? job.salary_max : undefined;
  const postedAt = parseDate(job.date, job.epoch);

  return {
    sourceId: 'remoteok',
    externalId: `remoteok:${String(job.id)}`,
    url: job.url,
    title: job.position,
    company: job.company,
    companyLogoUrl: normalizeLogoUrl(job.company_logo),
    location: job.location || undefined,
    isRemote: true,
    description: job.description?.trim() || `${job.position} at ${job.company}`,
    tags: normalizeTags(job.tags),
    salary:
      (salaryMin ?? 0) > 0 || (salaryMax ?? 0) > 0
        ? { min: salaryMin, max: salaryMax, currency: 'USD' }
        : undefined,
    postedAt,
    applyUrl: job.apply_url || undefined,
    raw,
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toRemoteOKJob(value: unknown): { job: RemoteOKJob; raw: JsonRecord } | null {
  if (!isRecord(value)) {
    return null;
  }

  const idRaw = value.id;
  const position = asString(value.position)?.trim();
  const company = asString(value.company)?.trim();
  const url = asString(value.url)?.trim();
  if (!position || !company || !url || (typeof idRaw !== 'string' && typeof idRaw !== 'number')) {
    return null;
  }

  return {
    job: {
      id: idRaw,
      position,
      company,
      company_logo: asString(value.company_logo),
      location: asString(value.location),
      tags: value.tags,
      description: asString(value.description),
      salary_min: asNumber(value.salary_min),
      salary_max: asNumber(value.salary_max),
      apply_url: asString(value.apply_url),
      url,
      date: asString(value.date),
      epoch: asNumber(value.epoch),
    },
    raw: value,
  };
}

async function fetchRemoteOKJobs(): Promise<unknown[]> {
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
      const statusError = new Error(`RemoteOK API returned ${res.status}`);
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
      if (!Array.isArray(payload)) {
        throw new Error('RemoteOK API returned non-array payload');
      }

      return payload;
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(`RemoteOK API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`RemoteOK API request failed after ${MAX_ATTEMPTS} attempts`);
}

export async function parse(): Promise<ParseResult> {
  const data = await fetchRemoteOKJobs();
  const jobs = data
    .map(toRemoteOKJob)
    .filter((item): item is { job: RemoteOKJob; raw: JsonRecord } => item !== null)
    .map((item) => toRawJob(item.job, item.raw));

  return { jobs };
}

export const remoteOKParser = defineParser({
  manifest: {
    id: 'remoteok',
    name: 'RemoteOK',
    version: '0.1.0',
    schedule: '0 */4 * * *',
  },
  parse,
});
