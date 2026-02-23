import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { mapVacancyToRawJob } from '../src/mapper.js';
import type { HhVacancyDetail } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/vacancy-detail.json'), 'utf-8'),
) as HhVacancyDetail;

describe('HH mapper', () => {
  it('maps HH vacancy to RawJob fields', () => {
    const rawJob = mapVacancyToRawJob(fixture);

    expect(rawJob.sourceId).toBe('hh');
    expect(rawJob.externalId).toBe('hh:130668144');
    expect(rawJob.url).toBe('https://hh.ru/vacancy/130668144');
    expect(rawJob.title).toBe('Python-разработчик');
    expect(rawJob.company).toBe('Алабуга, ОЭЗ ППТ');
    expect(rawJob.isRemote).toBe(true);
    expect(rawJob.applyUrl).toBe('https://hh.ru/applicant/vacancy_response?vacancyId=130668144');
  });

  it('maps salary and tags', () => {
    const rawJob = mapVacancyToRawJob(fixture);

    expect(rawJob.salary).toEqual({
      min: 127500,
      max: undefined,
      currency: 'RUR',
    });

    expect(rawJob.tags).toContain('Python');
    expect(rawJob.tags).toContain('Django');
    expect(rawJob.tags).toContain('Программист, разработчик');
  });
});
