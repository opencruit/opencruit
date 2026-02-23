import type { ValidatedRawJob } from '@opencruit/parser-sdk';
import type { NormalizedJob } from './types.js';

const MAX_LOCATION_LENGTH = 255;

/**
 * Trim whitespace and collapse multiple spaces.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Strip HTML tags from a string. Converts block-level elements to newlines
 * to preserve document structure, then removes remaining tags.
 * Decodes common HTML entities.
 */
export function stripHtml(html: string): string {
  let text = html;

  // Preserve block-level breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Collapse excessive newlines (3+ → 2)
  text = text.replace(/\n{3,}/g, '\n\n');

  // Trim each line
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return text;
}

/**
 * Remove RemoteOK anti-bot spam text from descriptions.
 * Pattern: "Please mention the word **WORD** and tag BASE64..."
 */
export function stripRemoteOKSpam(description: string): string {
  const spamPattern =
    /\s*Please mention the word \*{0,2}\w+\*{0,2} and tag \S+ when applying to show you read the job post completely.*$/s;
  return description.replace(spamPattern, '').trim();
}

/**
 * Normalize tags: lowercase, trim, deduplicate, filter empty.
 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = tag.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Basic location cleanup. Trims whitespace, normalizes "Remote, ..." prefix.
 */
export function normalizeLocation(location: string): string {
  let loc = normalizeWhitespace(location);

  // "Remote, USA" → "USA (Remote)"
  // "Remote - Europe" → "Europe (Remote)"
  const remotePrefix = /^Remote[,\s-]+(.+)$/i;
  const match = loc.match(remotePrefix);
  if (match) {
    loc = `${match[1].trim()} (Remote)`;
  }

  if (loc.length > MAX_LOCATION_LENGTH) {
    loc = loc.slice(0, MAX_LOCATION_LENGTH).trim();
  }

  return loc;
}

/**
 * Apply all normalizations to a validated raw job.
 * Pure function — no side effects, no DB access.
 */
export function normalize(job: ValidatedRawJob): NormalizedJob {
  let description = job.description;

  // Strip spam BEFORE HTML (spam markers contain markdown/HTML)
  description = stripRemoteOKSpam(description);

  // Strip HTML tags (WWR descriptions are HTML, RemoteOK has some HTML)
  description = stripHtml(description);

  return {
    ...job,
    title: normalizeWhitespace(job.title),
    company: normalizeWhitespace(job.company),
    description,
    location: job.location ? normalizeLocation(job.location) : undefined,
    tags: job.tags ? normalizeTags(job.tags) : undefined,
    _normalized: true as const,
  };
}
