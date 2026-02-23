import type { RawJob } from '@opencruit/parser-sdk';
import type { HhVacancyDetail } from './types.js';

function deriveIsRemote(vacancy: HhVacancyDetail): boolean {
  if (vacancy.schedule?.id.toLowerCase() === 'remote') {
    return true;
  }

  return (vacancy.work_format ?? []).some((item) => item.id.toLowerCase() === 'remote');
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function mapSalary(vacancy: HhVacancyDetail): RawJob['salary'] {
  const source = vacancy.salary ?? vacancy.salary_range;

  if (!source) return undefined;

  if (source.from === null && source.to === null) {
    return undefined;
  }

  return {
    min: source.from ?? undefined,
    max: source.to ?? undefined,
    currency: source.currency,
  };
}

export function mapVacancyToRawJob(vacancy: HhVacancyDetail): RawJob {
  const tags = dedupe([
    ...(vacancy.key_skills ?? []).map((item) => item.name),
    ...(vacancy.professional_roles ?? []).map((item) => item.name),
  ]);

  const location = vacancy.address?.city ?? vacancy.area?.name;
  const description = vacancy.description?.trim() || vacancy.name;

  return {
    sourceId: 'hh',
    externalId: `hh:${vacancy.id}`,
    url: vacancy.alternate_url,
    title: vacancy.name,
    company: vacancy.employer?.name ?? 'Unknown',
    location,
    isRemote: deriveIsRemote(vacancy),
    description,
    tags: tags.length > 0 ? tags : undefined,
    salary: mapSalary(vacancy),
    postedAt: new Date(vacancy.published_at),
    applyUrl: vacancy.apply_alternate_url ?? vacancy.alternate_url,
    raw: vacancy as unknown as Record<string, unknown>,
  };
}
