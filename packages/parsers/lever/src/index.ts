import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const API_BASE = 'https://api.lever.co/v0/postings';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [200, 500];

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

interface LeverJob {
  id: string;
  title: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  description: string;
  location?: string;
  team?: string;
  commitment?: string;
  workplaceType?: string;
  site: string;
  raw: Record<string, unknown>;
}

interface ResolvedConfig {
  sites: string[];
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

function parseDate(raw: number | undefined): Date | undefined {
  if (!raw || !Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function looksRemote(title: string, location: string | undefined, workplaceType: string | undefined): boolean {
  const text = `${title} ${location ?? ''} ${workplaceType ?? ''}`.toLowerCase();
  return text.includes('remote') || text.includes('distributed') || text.includes('anywhere') || text.includes('hybrid');
}

function isLikelyTechJob(title: string, team: string | undefined): boolean {
  const text = `${title} ${team ?? ''}`.toLowerCase();
  return TECH_KEYWORDS.some((keyword) => text.includes(keyword));
}

function resolveConfig(config?: Record<string, unknown>): ResolvedConfig {
  if (!config) {
    throw new Error('Lever parser config is required');
  }

  const sitesRaw = config.sites;
  const sites =
    Array.isArray(sitesRaw) && sitesRaw.every((site) => typeof site === 'string')
      ? sitesRaw.map((site) => site.trim().toLowerCase()).filter((site) => site.length > 0)
      : [];

  if (sites.length === 0) {
    throw new Error('Lever parser requires at least one site');
  }

  return {
    sites: [...new Set(sites)],
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLeverJob(payload: unknown, site: string): LeverJob | null {
  if (!isRecord(payload)) {
    return null;
  }

  const id = asString(payload.id)?.trim();
  const title = asString(payload.text)?.trim();
  const hostedUrl = asString(payload.hostedUrl)?.trim();
  if (!id || !title || !hostedUrl) {
    return null;
  }

  const categories = isRecord(payload.categories) ? payload.categories : undefined;
  const location = categories ? asString(categories.location)?.trim() : undefined;
  const team = categories ? asString(categories.team)?.trim() : undefined;
  const commitment = categories ? asString(categories.commitment)?.trim() : undefined;

  const description =
    asString(payload.descriptionPlain)?.trim() ||
    asString(payload.descriptionBodyPlain)?.trim() ||
    asString(payload.description)?.trim() ||
    `${title} at ${site}`;

  return {
    id,
    title,
    hostedUrl,
    applyUrl: asString(payload.applyUrl)?.trim(),
    createdAt: asNumber(payload.createdAt),
    description,
    location,
    team,
    commitment,
    workplaceType: asString(payload.workplaceType)?.trim(),
    site,
    raw: payload,
  };
}

async function fetchSite(site: string): Promise<LeverJob[]> {
  let lastError: Error | undefined;
  const url = `${API_BASE}/${encodeURIComponent(site)}?mode=json`;

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
        return [];
      }

      const statusError = new Error(`Lever API returned ${res.status}`);
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
        throw new Error('Lever API returned non-array payload');
      }

      return payload.map((item) => parseLeverJob(item, site)).filter((item): item is LeverJob => item !== null);
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error(String(error));
      lastError = new Error(`Lever API response parse failed: ${parseError.message}`);
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Lever API request failed after ${MAX_ATTEMPTS} attempts`);
}

function toRawJob(job: LeverJob): RawJob {
  const tags = [job.team, job.commitment].filter((value): value is string => !!value);

  return {
    sourceId: 'lever',
    externalId: `lever:${job.site}:${job.id}`,
    url: job.hostedUrl,
    title: job.title,
    company: job.site,
    location: job.location || undefined,
    isRemote: looksRemote(job.title, job.location, job.workplaceType),
    description: job.description,
    tags: tags.length > 0 ? tags : undefined,
    postedAt: parseDate(job.createdAt),
    applyUrl: job.applyUrl || job.hostedUrl,
    raw: job.raw,
  };
}

export async function parse(config?: Record<string, unknown>): Promise<ParseResult> {
  const resolved = resolveConfig(config);
  const jobs: RawJob[] = [];
  const seen = new Set<string>();

  for (const site of resolved.sites) {
    const siteJobs = await fetchSite(site);

    for (const job of siteJobs) {
      if (!isLikelyTechJob(job.title, job.team)) {
        continue;
      }

      const rawJob = toRawJob(job);
      if (seen.has(rawJob.externalId)) {
        continue;
      }

      seen.add(rawJob.externalId);
      jobs.push(rawJob);
    }
  }

  return { jobs };
}

export const leverParser = defineParser({
  manifest: {
    id: 'lever',
    name: 'Lever',
    version: '0.1.0',
    schedule: '20 */12 * * *',
  },
  parse,
});
