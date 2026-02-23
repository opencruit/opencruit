import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_BASE = 'https://api.adzuna.com/v1/api/jobs';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [200, 500];
const DEFAULT_QUERY = 'software engineer OR developer OR devops OR data engineer';
const DEFAULT_RESULTS_PER_PAGE = 50;
const DEFAULT_MAX_PAGES = 20;

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

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  redirectUrl: string;
  createdAt?: string;
  companyName?: string;
  location?: string;
  category?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  country: string;
  raw: Record<string, unknown>;
}

interface AdzunaResponse {
  results: AdzunaJob[];
  count: number;
}

interface ResolvedConfig {
  appId: string;
  appKey: string;
  countries: string[];
  query: string;
  maxPages: number;
  resultsPerPage: number;
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

function resolveConfig(config?: Record<string, unknown>): ResolvedConfig {
  if (!config) {
    throw new Error('Adzuna parser config is required');
  }

  const appId = asString(config.appId)?.trim();
  const appKey = asString(config.appKey)?.trim();
  if (!appId || !appKey) {
    throw new Error('Adzuna parser requires appId and appKey');
  }

  const countriesRaw = config.countries;
  const countries =
    Array.isArray(countriesRaw) && countriesRaw.every((country) => typeof country === 'string')
      ? countriesRaw.map((country) => country.trim().toLowerCase()).filter((country) => country.length > 0)
      : [];

  if (countries.length === 0) {
    throw new Error('Adzuna parser requires at least one country');
  }

  return {
    appId,
    appKey,
    countries,
    query: asString(config.query)?.trim() || DEFAULT_QUERY,
    maxPages: asPositiveInt(config.maxPages, DEFAULT_MAX_PAGES),
    resultsPerPage: asPositiveInt(config.resultsPerPage, DEFAULT_RESULTS_PER_PAGE),
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function looksRemote(title: string, location: string | undefined): boolean {
  const text = `${title} ${location ?? ''}`.toLowerCase();
  return text.includes('remote') || text.includes('distributed') || text.includes('anywhere') || text.includes('hybrid');
}

function isLikelyTechJob(title: string, category: string | undefined): boolean {
  const text = `${title} ${category ?? ''}`.toLowerCase();
  return TECH_KEYWORDS.some((keyword) => text.includes(keyword));
}

function parseAdzunaJob(payload: unknown, country: string): AdzunaJob | null {
  if (!isRecord(payload)) {
    return null;
  }

  const idRaw = payload.id;
  const id =
    typeof idRaw === 'string'
      ? idRaw
      : typeof idRaw === 'number' && Number.isFinite(idRaw)
        ? String(idRaw)
        : undefined;

  const title = asString(payload.title)?.trim();
  const redirectUrl = asString(payload.redirect_url)?.trim();
  if (!id || !title || !redirectUrl) {
    return null;
  }

  const company = isRecord(payload.company) ? asString(payload.company.display_name)?.trim() : undefined;
  const location = isRecord(payload.location) ? asString(payload.location.display_name)?.trim() : undefined;
  const category = isRecord(payload.category) ? asString(payload.category.label)?.trim() : undefined;

  return {
    id,
    title,
    description: asString(payload.description)?.trim() || `${title}${company ? ` at ${company}` : ''}`,
    redirectUrl,
    createdAt: asString(payload.created),
    companyName: company,
    location,
    category,
    salaryMin: asNumber(payload.salary_min),
    salaryMax: asNumber(payload.salary_max),
    salaryCurrency: asString(payload.salary_currency),
    country,
    raw: payload,
  };
}

function parseResponse(payload: unknown, country: string): AdzunaResponse {
  if (!isRecord(payload)) {
    throw new Error('Adzuna API returned invalid payload');
  }

  const resultsRaw = Array.isArray(payload.results) ? payload.results : [];
  const results = resultsRaw
    .map((item) => parseAdzunaJob(item, country))
    .filter((item): item is AdzunaJob => item !== null);

  const count = asNumber(payload.count) ?? results.length;

  return { results, count };
}

async function fetchPage(country: string, page: number, config: ResolvedConfig): Promise<AdzunaResponse> {
  let lastError: Error | undefined;

  const params = new URLSearchParams({
    app_id: config.appId,
    app_key: config.appKey,
    results_per_page: String(config.resultsPerPage),
    what: config.query,
  });

  const url = `${API_BASE}/${encodeURIComponent(country)}/search/${page}?${params.toString()}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;

    try {
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
      const statusError = new Error(`Adzuna API returned ${res.status}`);
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
      lastError = new Error(`Adzuna API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Adzuna API request failed after ${MAX_ATTEMPTS} attempts`);
}

function toRawJob(job: AdzunaJob): RawJob {
  const salaryKnown = (job.salaryMin ?? 0) > 0 || (job.salaryMax ?? 0) > 0;

  return {
    sourceId: 'adzuna',
    externalId: `adzuna:${job.country}:${job.id}`,
    url: job.redirectUrl,
    title: job.title,
    company: job.companyName || 'Unknown company',
    location: job.location || undefined,
    isRemote: looksRemote(job.title, job.location),
    description: job.description,
    tags: job.category ? [job.category] : undefined,
    salary: salaryKnown
      ? {
          min: job.salaryMin,
          max: job.salaryMax,
          currency: job.salaryCurrency || undefined,
        }
      : undefined,
    postedAt: parseDate(job.createdAt),
    applyUrl: job.redirectUrl,
    raw: job.raw,
  };
}

export async function parse(config?: Record<string, unknown>): Promise<ParseResult> {
  const resolved = resolveConfig(config);
  const jobs: RawJob[] = [];
  const seen = new Set<string>();

  for (const country of resolved.countries) {
    for (let page = 1; page <= resolved.maxPages; page++) {
      const response = await fetchPage(country, page, resolved);
      if (response.results.length === 0) {
        break;
      }

      for (const job of response.results) {
        if (!isLikelyTechJob(job.title, job.category)) {
          continue;
        }

        const rawJob = toRawJob(job);
        if (seen.has(rawJob.externalId)) {
          continue;
        }

        seen.add(rawJob.externalId);
        jobs.push(rawJob);
      }

      if (response.results.length < resolved.resultsPerPage) {
        break;
      }
    }
  }

  return { jobs };
}

export const adzunaParser = defineParser({
  manifest: {
    id: 'adzuna',
    name: 'Adzuna',
    version: '0.1.0',
    schedule: '0 */6 * * *',
  },
  parse,
});
