import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_BASE = 'https://api.smartrecruiters.com/v1/companies';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [200, 500];
const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_PAGES = 2;

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

interface SmartRecruitersListing {
  id: string;
  name: string;
  ref?: string;
  postingUrl?: string;
  applyUrl?: string;
  releasedDate?: string;
  location?: string;
  department?: string;
  functionName?: string;
  typeOfEmployment?: string;
  company: string;
  raw: Record<string, unknown>;
}

interface SmartRecruitersListResponse {
  content: SmartRecruitersListing[];
  totalFound: number;
  offset: number;
  limit: number;
}

interface SmartRecruitersDetail {
  applyUrl?: string;
  postingUrl?: string;
  sections: string[];
  raw: Record<string, unknown>;
}

interface ResolvedConfig {
  companies: string[];
  maxPages: number;
  limit: number;
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

function looksRemote(title: string, location: string | undefined): boolean {
  const text = `${title} ${location ?? ''}`.toLowerCase();
  return text.includes('remote') || text.includes('distributed') || text.includes('anywhere') || text.includes('hybrid');
}

function isLikelyTechJob(title: string, department: string | undefined, functionName: string | undefined): boolean {
  const text = `${title} ${department ?? ''} ${functionName ?? ''}`.toLowerCase();
  return TECH_KEYWORDS.some((keyword) => text.includes(keyword));
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveConfig(config?: Record<string, unknown>): ResolvedConfig {
  if (!config) {
    throw new Error('SmartRecruiters parser config is required');
  }

  const companiesRaw = config.companies;
  const companies =
    Array.isArray(companiesRaw) && companiesRaw.every((company) => typeof company === 'string')
      ? companiesRaw.map((company) => company.trim().toLowerCase()).filter((company) => company.length > 0)
      : [];

  if (companies.length === 0) {
    throw new Error('SmartRecruiters parser requires at least one company identifier');
  }

  return {
    companies: [...new Set(companies)],
    maxPages: asPositiveInt(config.maxPages, DEFAULT_MAX_PAGES),
    limit: asPositiveInt(config.limit, DEFAULT_LIMIT),
  };
}

async function requestJson(url: string): Promise<unknown> {
  let lastError: Error | undefined;

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
      if (res.status === 404) {
        return null;
      }

      const statusError = new Error(`SmartRecruiters API returned ${res.status}`);
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
      return await res.json();
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(`SmartRecruiters API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`SmartRecruiters API request failed after ${MAX_ATTEMPTS} attempts`);
}

function parseListing(payload: unknown, company: string): SmartRecruitersListing | null {
  if (!isRecord(payload)) {
    return null;
  }

  const id = asString(payload.id)?.trim();
  const name = asString(payload.name)?.trim();
  if (!id || !name) {
    return null;
  }

  const location = isRecord(payload.location)
    ? asString(payload.location.fullLocation)?.trim() ||
      [asString(payload.location.city), asString(payload.location.region), asString(payload.location.country)]
        .filter((value): value is string => !!value && value.trim().length > 0)
        .join(', ')
    : undefined;

  const department = isRecord(payload.department) ? asString(payload.department.label)?.trim() : undefined;
  const functionName = isRecord(payload.function) ? asString(payload.function.label)?.trim() : undefined;
  const typeOfEmployment = isRecord(payload.typeOfEmployment) ? asString(payload.typeOfEmployment.label)?.trim() : undefined;

  return {
    id,
    name,
    ref: asString(payload.ref)?.trim(),
    postingUrl: asString(payload.postingUrl)?.trim(),
    applyUrl: asString(payload.applyUrl)?.trim(),
    releasedDate: asString(payload.releasedDate)?.trim(),
    location: location || undefined,
    department,
    functionName,
    typeOfEmployment,
    company,
    raw: payload,
  };
}

function parseListResponse(payload: unknown, company: string): SmartRecruitersListResponse {
  if (!isRecord(payload)) {
    throw new Error('SmartRecruiters API returned invalid listing payload');
  }

  const rawContent = Array.isArray(payload.content) ? payload.content : [];
  const content = rawContent.map((item) => parseListing(item, company)).filter((item): item is SmartRecruitersListing => item !== null);

  return {
    content,
    totalFound: asNumber(payload.totalFound) ?? content.length,
    offset: asNumber(payload.offset) ?? 0,
    limit: asNumber(payload.limit) ?? content.length,
  };
}

function extractDetailSections(payload: unknown): SmartRecruitersDetail | null {
  if (!isRecord(payload)) {
    return null;
  }

  const jobAd = isRecord(payload.jobAd) ? payload.jobAd : undefined;
  const sections = isRecord(jobAd?.sections) ? jobAd.sections : undefined;
  const sectionTexts: string[] = [];

  if (sections) {
    for (const sectionValue of Object.values(sections)) {
      if (!isRecord(sectionValue)) {
        continue;
      }

      const text = asString(sectionValue.text)?.trim();
      if (text && text.length > 0) {
        sectionTexts.push(text);
      }
    }
  }

  return {
    applyUrl: asString(payload.applyUrl)?.trim(),
    postingUrl: asString(payload.postingUrl)?.trim(),
    sections: sectionTexts,
    raw: payload,
  };
}

async function fetchListings(company: string, offset: number, limit: number): Promise<SmartRecruitersListResponse | null> {
  const url = `${API_BASE}/${encodeURIComponent(company)}/postings?limit=${limit}&offset=${offset}`;
  const payload = await requestJson(url);
  if (payload === null) {
    return null;
  }

  return parseListResponse(payload, company);
}

async function fetchDetail(company: string, listing: SmartRecruitersListing): Promise<SmartRecruitersDetail | null> {
  const detailUrl = listing.ref || `${API_BASE}/${encodeURIComponent(company)}/postings/${encodeURIComponent(listing.id)}`;
  const payload = await requestJson(detailUrl);
  if (payload === null) {
    return null;
  }

  return extractDetailSections(payload);
}

function toRawJob(listing: SmartRecruitersListing, detail: SmartRecruitersDetail | null): RawJob {
  const description = detail?.sections.length
    ? detail.sections.join('\n\n')
    : `${listing.name} at ${listing.company}`;

  const tags = [listing.department, listing.functionName, listing.typeOfEmployment].filter((value): value is string => !!value);
  const url = detail?.postingUrl || listing.postingUrl || detail?.applyUrl || listing.applyUrl || listing.ref || '';

  return {
    sourceId: 'smartrecruiters',
    externalId: `smartrecruiters:${listing.company}:${listing.id}`,
    url,
    title: listing.name,
    company: listing.company,
    location: listing.location || undefined,
    isRemote: looksRemote(listing.name, listing.location),
    description,
    tags: tags.length > 0 ? tags : undefined,
    postedAt: parseDate(listing.releasedDate),
    applyUrl: detail?.applyUrl || listing.applyUrl || url,
    raw: {
      listing: listing.raw,
      detail: detail?.raw ?? null,
    },
  };
}

export async function parse(config?: Record<string, unknown>): Promise<ParseResult> {
  const resolved = resolveConfig(config);
  const jobs: RawJob[] = [];
  const seen = new Set<string>();

  for (const company of resolved.companies) {
    for (let page = 0; page < resolved.maxPages; page++) {
      const offset = page * resolved.limit;
      const listResponse = await fetchListings(company, offset, resolved.limit);
      if (!listResponse || listResponse.content.length === 0) {
        break;
      }

      for (const listing of listResponse.content) {
        if (!isLikelyTechJob(listing.name, listing.department, listing.functionName)) {
          continue;
        }

        const externalId = `smartrecruiters:${listing.company}:${listing.id}`;
        if (seen.has(externalId)) {
          continue;
        }

        const detail = await fetchDetail(company, listing);
        const rawJob = toRawJob(listing, detail);
        if (!rawJob.url || rawJob.url.length === 0) {
          continue;
        }

        seen.add(externalId);
        jobs.push(rawJob);
      }

      if (listResponse.limit <= 0) {
        break;
      }

      if (listResponse.offset + listResponse.limit >= listResponse.totalFound) {
        break;
      }
    }
  }

  return { jobs };
}

export const smartRecruitersParser = defineParser({
  manifest: {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    version: '0.1.0',
    schedule: '25 */12 * * *',
  },
  parse,
});
