import type { Parser, ParseResult, RawJob } from '@opencruit/parser-sdk';

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

export async function parse(): Promise<ParseResult> {
  const res = await fetch('https://remoteok.com/api', {
    headers: { 'User-Agent': 'OpenCruit/0.1 (+https://github.com/opencruit/opencruit)' },
  });

  if (!res.ok) {
    throw new Error(`RemoteOK API returned ${res.status}`);
  }

  const data = (await res.json()) as RemoteOKJob[];

  // First element is a legal notice, skip it
  const jobs = data.slice(1).map(toRawJob);

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
