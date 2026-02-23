import { joobleParser } from '@opencruit/parser-jooble';
import { defineSource } from '../define-source.js';

const DEFAULT_COUNTRIES = ['us', 'gb', 'de', 'nl', 'pl'];
const DEFAULT_KEYWORDS = ['software engineer', 'backend engineer', 'frontend engineer', 'full stack developer', 'devops engineer'];

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

export const joobleSource = defineSource({
  id: joobleParser.manifest.id,
  kind: 'batch',
  pool: 'light',
  runtime: {
    attempts: 3,
    backoffMs: 5000,
  },
  requiredEnv: ['JOOBLE_API_KEY'],
  resolveParseConfig: () => ({
    apiKey: process.env.JOOBLE_API_KEY?.trim(),
    countries: parseCountries(process.env.JOOBLE_COUNTRIES),
    keywords: [...DEFAULT_KEYWORDS],
  }),
  parser: joobleParser,
});
