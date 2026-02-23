import { XMLParser } from 'fast-xml-parser';
import type { Parser, ParseResult, RawJob } from '@opencruit/parser-sdk';

const RSS_URL = 'https://weworkremotely.com/remote-jobs.rss';

interface WwrItem {
  title: string;
  link: string;
  guid: string;
  description: string;
  pubDate: string;
  region?: string;
  category?: string;
  type?: string;
  skills?: string;
  'media:content'?: {
    '@_url': string;
  };
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

function toRawJob(item: WwrItem): RawJob | null {
  const parsed = parseTitle(item.title);
  if (!parsed) return null;

  return {
    sourceId: 'weworkremotely',
    externalId: `weworkremotely:${extractSlug(item.link)}`,
    url: item.link,
    title: parsed.title,
    company: parsed.company,
    companyLogoUrl: item['media:content']?.['@_url'] || undefined,
    location: item.region || undefined,
    isRemote: true,
    description: item.description,
    tags: parseTags(item.skills, item.category),
    postedAt: new Date(item.pubDate),
    applyUrl: item.link,
    raw: item as unknown as Record<string, unknown>,
  };
}

export async function parse(): Promise<ParseResult> {
  const res = await fetch(RSS_URL, {
    headers: { 'User-Agent': 'OpenCruit/0.1 (+https://github.com/opencruit/opencruit)' },
  });

  if (!res.ok) {
    throw new Error(`WeWorkRemotely RSS returned ${res.status}`);
  }

  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });

  const feed = parser.parse(xml) as { rss?: { channel?: { item?: WwrItem | WwrItem[] } } };
  const rawItems = feed?.rss?.channel?.item;
  const items: WwrItem[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  const jobs = items.map(toRawJob).filter((job): job is RawJob => job !== null);

  return { jobs };
}

export const weWorkRemotelyParser: Parser = {
  manifest: {
    id: 'weworkremotely',
    name: 'We Work Remotely',
    version: '0.1.0',
    schedule: '0 */4 * * *',
  },
  parse,
};
