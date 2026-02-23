import { XMLParser } from 'fast-xml-parser';
import { defineParser, type ParseResult, type RawJob } from '@opencruit/parser-sdk';

const RSS_URL = 'https://weworkremotely.com/remote-jobs.rss';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 300];

interface WwrItem {
  title: string;
  link: string;
  guid?: string;
  description: string;
  pubDate?: string;
  region?: string;
  category?: string;
  type?: string;
  skills?: string;
  companyLogoUrl?: string;
  raw: Record<string, unknown>;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseTitle(raw: string): { company: string; title: string } | null {
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) return null;

  const company = raw.slice(0, colonIdx).trim();
  const title = raw.slice(colonIdx + 1).trim();

  if (!company || !title) return null;
  return { company, title };
}

function extractSlug(link: string): string {
  const marker = '/remote-jobs/';
  const idx = link.indexOf(marker);
  return idx !== -1 ? link.slice(idx + marker.length) : link;
}

function parseTags(skills: string | undefined, category: string | undefined): string[] | undefined {
  const tags: string[] = [];

  if (skills) {
    tags.push(
      ...skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  if (category) {
    tags.push(category);
  }

  return tags.length > 0 ? tags : undefined;
}

function parseDate(dateRaw: string | undefined): Date | undefined {
  if (!dateRaw) {
    return undefined;
  }

  const parsed = new Date(dateRaw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toWwrItem(value: unknown): WwrItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = asString(value.title);
  const link = asString(value.link) ?? asString(value.guid);
  if (!title || !link) {
    return null;
  }

  const mediaContent = value['media:content'];
  const companyLogoUrl = isRecord(mediaContent) ? asString(mediaContent['@_url']) : undefined;

  return {
    title,
    link,
    guid: asString(value.guid),
    description: asString(value.description) ?? title,
    pubDate: asString(value.pubDate),
    region: asString(value.region),
    category: asString(value.category),
    type: asString(value.type),
    skills: asString(value.skills),
    companyLogoUrl,
    raw: value,
  };
}

function toRawJob(item: WwrItem): RawJob | null {
  const parsed = parseTitle(item.title);
  if (!parsed) return null;

  return {
    sourceId: 'weworkremotely',
    externalId: `weworkremotely:${extractSlug(item.link)}`,
    url: item.link,
    title: parsed.title,
    company: parsed.company,
    companyLogoUrl: item.companyLogoUrl || undefined,
    location: item.region || undefined,
    isRemote: true,
    description: item.description,
    tags: parseTags(item.skills, item.category),
    postedAt: parseDate(item.pubDate),
    applyUrl: item.link,
    raw: item.raw,
  };
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRss(): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;

    try {
      res = await fetch(RSS_URL, {
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
      const statusError = new Error(`WeWorkRemotely RSS returned ${res.status}`);
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

    return res;
  }

  throw lastError ?? new Error(`WeWorkRemotely RSS request failed after ${MAX_ATTEMPTS} attempts`);
}

export async function parse(): Promise<ParseResult> {
  const res = await fetchRss();

  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
  });

  const feed = parser.parse(xml) as { rss?: { channel?: { item?: unknown | unknown[] } } };
  const rawItems = feed?.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  const jobs = items
    .map(toWwrItem)
    .filter((item): item is WwrItem => item !== null)
    .map(toRawJob)
    .filter((job): job is RawJob => job !== null);

  return { jobs };
}

export const weWorkRemotelyParser = defineParser({
  manifest: {
    id: 'weworkremotely',
    name: 'We Work Remotely',
    version: '0.1.0',
    schedule: '0 */4 * * *',
  },
  parse,
});
