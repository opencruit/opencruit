import { createHash } from 'node:crypto';
import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_BASE = 'https://jooble.org/api';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [200, 500];
const DEFAULT_MAX_PAGES = 5;

const TECH_KEYWORDS = [
  'engineer',
  'developer',
  'software',
  'devops',
  'data',
  'platform',
  'security',
  'frontend',
  'backend',
  'full stack',
  'machine learning',
  'ai',
  'site reliability',
  'sre',
  'qa',
  'it',
] as const;

interface JoobleJob {
  id: string;
  title: string;
  link: string;
  company: string;
  location?: string;
  snippet?: string;
  salary?: string;
  updatedAt?: string;
  country: string;
  raw: Record<string, unknown>;
}

interface JoobleResponse {
  jobs: JoobleJob[];
  totalCount?: number;
}

interface ResolvedConfig {
  apiKey: string;
  countries: string[];
  query: string;
  maxPages: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseSalary(raw: string | undefined): RawJob['salary'] {
  if (!raw) {
    return undefined;
  }

  const match = raw.match(/(?:[$€£]\s*)?([\d,]+)\s*[-–]\s*(?:[$€£]\s*)?([\d,]+)/);
  if (!match) {
    return undefined;
  }

  const min = Number(match[1]?.replaceAll(',', ''));
  const max = Number(match[2]?.replaceAll(',', ''));
  if (!Number.isFinite(min) && !Number.isFinite(max)) {
    return undefined;
  }

  let currency: string | undefined;
  if (raw.includes('$')) {
    currency = 'USD';
  } else if (raw.includes('€')) {
    currency = 'EUR';
  } else if (raw.includes('£')) {
    currency = 'GBP';
  }

  return {
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined,
    currency,
  };
}

function looksRemote(title: string, location: string | undefined): boolean {
  const text = `${title} ${location ?? ''}`.toLowerCase();
  return text.includes('remote') || text.includes('distributed') || text.includes('anywhere') || text.includes('hybrid');
}

function isLikelyTechJob(title: string): boolean {
  const text = title.toLowerCase();
  return TECH_KEYWORDS.some((keyword) => text.includes(keyword));
}

function resolveConfig(config?: Record<string, unknown>): ResolvedConfig {
  if (!config) {
    throw new Error('Jooble parser config is required');
  }

  const apiKey = asString(config.apiKey)?.trim();
  if (!apiKey) {
    throw new Error('Jooble parser requires apiKey');
  }

  const countriesRaw = config.countries;
  const countries =
    Array.isArray(countriesRaw) && countriesRaw.every((country) => typeof country === 'string')
      ? countriesRaw.map((country) => country.trim().toLowerCase()).filter((country) => country.length > 0)
      : [];

  if (countries.length === 0) {
    throw new Error('Jooble parser requires at least one country');
  }

  const keywordsRaw = config.keywords;
  const keywords =
    Array.isArray(keywordsRaw) && keywordsRaw.every((keyword) => typeof keyword === 'string')
      ? keywordsRaw.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0)
      : [];

  const query = keywords.length > 0 ? keywords.join(' OR ') : 'software engineer OR developer OR devops OR data engineer';

  return {
    apiKey,
    countries,
    query,
    maxPages: asPositiveInt(config.maxPages, DEFAULT_MAX_PAGES),
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildExternalId(id: string | undefined, link: string): string {
  if (id && id.length > 0) {
    return id;
  }

  return createHash('sha256').update(link).digest('hex');
}

function parseJoobleJob(payload: unknown, country: string): JoobleJob | null {
  if (!isRecord(payload)) {
    return null;
  }

  const title = asString(payload.title)?.trim();
  const link = asString(payload.link)?.trim();
  if (!title || !link) {
    return null;
  }

  const id = buildExternalId(asString(payload.id)?.trim(), link);
  const company = asString(payload.company)?.trim() || 'Unknown company';

  return {
    id,
    title,
    link,
    company,
    location: asString(payload.location)?.trim(),
    snippet: asString(payload.snippet)?.trim(),
    salary: asString(payload.salary)?.trim(),
    updatedAt: asString(payload.updated)?.trim() ?? asString(payload.date)?.trim(),
    country,
    raw: payload,
  };
}

function parseResponse(payload: unknown, country: string): JoobleResponse {
  if (!isRecord(payload)) {
    throw new Error('Jooble API returned invalid payload');
  }

  const jobsRaw = Array.isArray(payload.jobs) ? payload.jobs : [];
  const jobs = jobsRaw.map((item) => parseJoobleJob(item, country)).filter((item): item is JoobleJob => item !== null);

  return {
    jobs,
    totalCount: asNumber(payload.totalCount),
  };
}

async function fetchPage(country: string, page: number, config: ResolvedConfig): Promise<JoobleResponse> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;

    try {
      res = await fetch(`${API_BASE}/${encodeURIComponent(config.apiKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'OpenCruit/0.1 (+https://github.com/opencruit/opencruit)',
        },
        body: JSON.stringify({
          keywords: config.query,
          location: country.toUpperCase(),
          page,
        }),
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
      const statusError = new Error(`Jooble API returned ${res.status}`);
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
      return parseResponse(payload, country);
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(`Jooble API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Jooble API request failed after ${MAX_ATTEMPTS} attempts`);
}

function toRawJob(job: JoobleJob): RawJob {
  const salary = parseSalary(job.salary);
  return {
    sourceId: 'jooble',
    externalId: `jooble:${job.country}:${job.id}`,
    url: job.link,
    title: job.title,
    company: job.company,
    location: job.location || undefined,
    isRemote: looksRemote(job.title, job.location),
    description: job.snippet || `${job.title} at ${job.company}`,
    salary,
    postedAt: parseDate(job.updatedAt),
    applyUrl: job.link,
    raw: job.raw,
  };
}

export async function parse(config?: Record<string, unknown>): Promise<ParseResult> {
  const resolved = resolveConfig(config);
  const jobs: RawJob[] = [];
  const seen = new Set<string>();

  for (const country of resolved.countries) {
    let collectedForCountry = 0;

    for (let page = 1; page <= resolved.maxPages; page++) {
      const response = await fetchPage(country, page, resolved);
      if (response.jobs.length === 0) {
        break;
      }

      for (const job of response.jobs) {
        if (!isLikelyTechJob(job.title)) {
          continue;
        }

        const rawJob = toRawJob(job);
        if (seen.has(rawJob.externalId)) {
          continue;
        }

        seen.add(rawJob.externalId);
        jobs.push(rawJob);
        collectedForCountry += 1;
      }

      if (response.totalCount !== undefined && collectedForCountry >= response.totalCount) {
        break;
      }
    }
  }

  return { jobs };
}

export const joobleParser = defineParser({
  manifest: {
    id: 'jooble',
    name: 'Jooble',
    version: '0.1.0',
    schedule: '0 */6 * * *',
  },
  parse,
});
