import { describe, it, expect } from 'vitest';
import {
  normalizeWhitespace,
  stripHtml,
  stripRemoteOKSpam,
  normalizeTags,
  normalizeLocation,
  normalize,
} from '../src/normalize.js';
import type { ValidatedRawJob } from '@opencruit/parser-sdk';

describe('normalizeWhitespace', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeWhitespace('  hello   world  ')).toBe('hello world');
  });

  it('collapses newlines and tabs', () => {
    expect(normalizeWhitespace('hello\n\n\tworld')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(normalizeWhitespace('')).toBe('');
  });
});

describe('stripHtml', () => {
  it('removes simple tags', () => {
    expect(stripHtml('<p>Hello</p>')).toBe('Hello');
  });

  it('converts br to newlines', () => {
    expect(stripHtml('line1<br/>line2')).toBe('line1\nline2');
  });

  it('converts self-closing br', () => {
    expect(stripHtml('line1<br />line2')).toBe('line1\nline2');
  });

  it('decodes HTML entities', () => {
    expect(stripHtml('&amp; &lt; &gt; &quot;')).toBe('& < > "');
  });

  it('handles nested tags', () => {
    const result = stripHtml('<div><p><strong>Bold</strong> text</p></div>');
    expect(result).toContain('Bold');
    expect(result).toContain('text');
    expect(result).not.toContain('<');
  });

  it('preserves paragraph structure as newlines', () => {
    const html = '<p>Paragraph 1</p><p>Paragraph 2</p>';
    const result = stripHtml(html);
    expect(result).toContain('Paragraph 1');
    expect(result).toContain('Paragraph 2');
    expect(result.split('\n').length).toBeGreaterThan(1);
  });

  it('collapses excessive newlines', () => {
    const html = '<p>One</p><p></p><p></p><p></p><p>Two</p>';
    const result = stripHtml(html);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('decodes &nbsp;', () => {
    expect(stripHtml('hello&nbsp;world')).toBe('hello world');
  });
});

describe('stripRemoteOKSpam', () => {
  it('removes INTRIGUE spam', () => {
    const desc =
      'Real job description.\n\nPlease mention the word **INTRIGUE** and tag RMTA5LjkzLjIzMS4xMTY= when applying to show you read the job post completely (#RMTA5LjkzLjIzMS4xMTY=). This is a beta feature to avoid spam applicants.';
    const result = stripRemoteOKSpam(desc);
    expect(result).toBe('Real job description.');
    expect(result).not.toContain('INTRIGUE');
  });

  it('removes spam after br tags', () => {
    const desc =
      'Description<br/><br/>Please mention the word **SPARKLE** and tag ABC= when applying to show you read the job post completely';
    const result = stripRemoteOKSpam(desc);
    expect(result).not.toContain('SPARKLE');
    expect(result).toContain('Description');
  });

  it('removes spam without markdown bold', () => {
    const desc = 'Description\n\nPlease mention the word MATURELY and tag XYZ= when applying to show you read the job post completely';
    const result = stripRemoteOKSpam(desc);
    expect(result).toBe('Description');
  });

  it('leaves clean descriptions unchanged', () => {
    const desc = 'A normal job description with no spam.';
    expect(stripRemoteOKSpam(desc)).toBe(desc);
  });
});

describe('normalizeTags', () => {
  it('lowercases and deduplicates', () => {
    expect(normalizeTags(['React', 'react', 'TypeScript'])).toEqual(['react', 'typescript']);
  });

  it('trims whitespace', () => {
    expect(normalizeTags([' react ', '  node  '])).toEqual(['react', 'node']);
  });

  it('filters empty strings', () => {
    expect(normalizeTags(['react', '', '  ', 'node'])).toEqual(['react', 'node']);
  });

  it('preserves order of first occurrence', () => {
    expect(normalizeTags(['Node', 'React', 'node'])).toEqual(['node', 'react']);
  });
});

describe('normalizeLocation', () => {
  it('trims whitespace', () => {
    expect(normalizeLocation('  New York  ')).toBe('New York');
  });

  it('normalizes "Remote, USA"', () => {
    expect(normalizeLocation('Remote, USA')).toBe('USA (Remote)');
  });

  it('normalizes "Remote - Europe"', () => {
    expect(normalizeLocation('Remote - Europe')).toBe('Europe (Remote)');
  });

  it('leaves plain locations unchanged', () => {
    expect(normalizeLocation('Buenos Aires')).toBe('Buenos Aires');
  });

  it('leaves "Anywhere in the World" unchanged', () => {
    expect(normalizeLocation('Anywhere in the World')).toBe('Anywhere in the World');
  });
});

describe('normalize', () => {
  const makeJob = (overrides: Partial<ValidatedRawJob> = {}): ValidatedRawJob => ({
    sourceId: 'test',
    externalId: 'test:1',
    url: 'https://example.com',
    title: 'Engineer',
    company: 'Acme',
    description: 'A job',
    ...overrides,
  });

  it('produces a NormalizedJob with _normalized brand', () => {
    const result = normalize(makeJob());
    expect(result._normalized).toBe(true);
  });

  it('trims title and company', () => {
    const result = normalize(makeJob({ title: '  Senior Engineer  ', company: ' Acme Corp ' }));
    expect(result.title).toBe('Senior Engineer');
    expect(result.company).toBe('Acme Corp');
  });

  it('normalizes tags', () => {
    const result = normalize(makeJob({ tags: ['React', 'react', ' Node '] }));
    expect(result.tags).toEqual(['react', 'node']);
  });

  it('strips HTML from description', () => {
    const result = normalize(makeJob({ description: '<p>Hello <strong>world</strong></p>' }));
    expect(result.description).not.toContain('<');
    expect(result.description).toContain('Hello');
    expect(result.description).toContain('world');
  });

  it('strips RemoteOK spam from description', () => {
    const desc =
      'Real content<br/><br/>Please mention the word **TEST** and tag ABC= when applying to show you read the job post completely';
    const result = normalize(makeJob({ description: desc }));
    expect(result.description).not.toContain('TEST');
    expect(result.description).toContain('Real content');
  });

  it('normalizes location', () => {
    const result = normalize(makeJob({ location: 'Remote, USA' }));
    expect(result.location).toBe('USA (Remote)');
  });

  it('handles undefined optional fields', () => {
    const result = normalize(makeJob({ location: undefined, tags: undefined }));
    expect(result.location).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });
});
