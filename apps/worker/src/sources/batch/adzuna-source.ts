import { adzunaParser } from '@opencruit/parser-adzuna';
import { defineSource } from '../define-source.js';

const DEFAULT_COUNTRIES = ['us', 'gb', 'de', 'nl', 'pl'];

function parseCountries(value: string | undefined): string[] {
  if (!value) {
    return [...DEFAULT_COUNTRIES];
  }

  const countries = value
    .split(',')
    .map((country) => country.trim().toLowerCase())
    .filter((country) => country.length > 0);

  return countries.length > 0 ? countries : [...DEFAULT_COUNTRIES];
}

export const adzunaSource = defineSource({
  id: adzunaParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  requiredEnv: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  resolveParseConfig: () => ({
    appId: process.env.ADZUNA_APP_ID?.trim(),
    appKey: process.env.ADZUNA_APP_KEY?.trim(),
    countries: parseCountries(process.env.ADZUNA_COUNTRIES),
  }),
  parser: adzunaParser,
});
