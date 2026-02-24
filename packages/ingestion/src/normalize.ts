import type { ValidatedRawJob } from '@opencruit/parser-sdk';
import type { NormalizedJob } from './types.js';

const MAX_LOCATION_LENGTH = 255;
const ALLOWED_RICH_TAGS = new Set([
  'p',
  'br',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'code',
  'pre',
  'a',
]);

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
  text = decodeHtmlEntities(text);

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
 * Decode a small set of common HTML entities.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&colon;/g, ':');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeHref(input: string): string | null {
  const decoded = decodeHtmlEntities(input).trim();
  if (!decoded) return null;

  if (/^https?:\/\//i.test(decoded)) {
    try {
      const parsed = new URL(decoded);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  if (/^mailto:/i.test(decoded)) {
    return decoded;
  }

  return null;
}

function sanitizeAnchorAttributes(attributes: string): string {
  const hrefMatch = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!hrefMatch) {
    return '';
  }

  const rawHref = (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '').trim();
  const safeHref = sanitizeHref(rawHref);
  if (!safeHref) {
    return '';
  }

  return ` href="${escapeHtml(safeHref)}" target="_blank" rel="nofollow noopener noreferrer"`;
}

/**
 * Sanitize external HTML to a safe, minimal subset for UI rendering.
 */
export function sanitizeRichHtml(html: string): string {
  let output = html.replace(/\r\n?/g, '\n');

  // Drop dangerous/irrelevant container tags with contents.
  output = output.replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '');
  output = output.replace(/<!--[\s\S]*?-->/g, '');

  output = output.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (full, tagName: string, rawAttrs: string | undefined) => {
    const closing = full.startsWith('</');
    let normalizedTag = tagName.toLowerCase();

    if (normalizedTag === 'b') normalizedTag = 'strong';
    if (normalizedTag === 'i') normalizedTag = 'em';

    if (!ALLOWED_RICH_TAGS.has(normalizedTag)) {
      return '';
    }

    if (closing) {
      return `</${normalizedTag}>`;
    }

    if (normalizedTag === 'br') {
      return '<br>';
    }

    if (normalizedTag === 'a') {
      const attrs = sanitizeAnchorAttributes(rawAttrs ?? '');
      return `<a${attrs}>`;
    }

    return `<${normalizedTag}>`;
  });

  // Collapse extra blank lines between blocks to keep rendering compact.
  output = output.replace(/\n{3,}/g, '\n\n').trim();
  return output;
}

function toRichHtmlFromText(description: string): string {
  const lines = description
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());

  const chunks: string[] = [];
  let paragraph: string[] = [];
  let openList: 'ul' | 'ol' | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    chunks.push(`<p>${paragraph.map(escapeHtml).join('<br>')}</p>`);
    paragraph = [];
  };

  const closeList = (): void => {
    if (!openList) return;
    chunks.push(`</${openList}>`);
    openList = null;
  };

  for (const line of lines) {
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }

    const ulMatch = line.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (openList !== 'ul') {
        closeList();
        chunks.push('<ul>');
        openList = 'ul';
      }
      chunks.push(`<li>${escapeHtml(ulMatch[1]!.trim())}</li>`);
      continue;
    }

    const olMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (openList !== 'ol') {
        closeList();
        chunks.push('<ol>');
        openList = 'ol';
      }
      chunks.push(`<li>${escapeHtml(olMatch[1]!.trim())}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();

  return chunks.join('\n');
}

/**
 * Build sanitized rich HTML for rendering while keeping text version for search.
 */
export function toRichDescription(rawDescription: string, plainDescription: string): string {
  const input = rawDescription.trim();
  if (!input) {
    return '';
  }

  if (/<\/?[a-z][^>]*>/i.test(input)) {
    const sanitized = sanitizeRichHtml(input);
    if (sanitized) {
      return sanitized;
    }
  }

  return toRichHtmlFromText(plainDescription);
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
  const richInput = description;

  // Strip HTML tags (WWR descriptions are HTML, RemoteOK has some HTML)
  description = stripHtml(description);

  return {
    ...job,
    title: normalizeWhitespace(job.title),
    company: normalizeWhitespace(job.company),
    description,
    descriptionRich: toRichDescription(richInput, description),
    location: job.location ? normalizeLocation(job.location) : undefined,
    tags: job.tags ? normalizeTags(job.tags) : undefined,
    _normalized: true as const,
  };
}
