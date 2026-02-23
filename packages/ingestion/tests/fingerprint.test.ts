import { describe, it, expect } from 'vitest';
import { computeFingerprint } from '../src/fingerprint.js';

describe('computeFingerprint', () => {
  it('produces a 64-char hex string', () => {
    const fp = computeFingerprint('Acme', 'Engineer', 'NYC');
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is case-insensitive', () => {
    const fp1 = computeFingerprint('ACME', 'ENGINEER', 'NYC');
    const fp2 = computeFingerprint('acme', 'engineer', 'nyc');
    expect(fp1).toBe(fp2);
  });

  it('trims whitespace', () => {
    const fp1 = computeFingerprint('  Acme  ', '  Engineer  ', '  NYC  ');
    const fp2 = computeFingerprint('Acme', 'Engineer', 'NYC');
    expect(fp1).toBe(fp2);
  });

  it('handles undefined location', () => {
    const fp1 = computeFingerprint('Acme', 'Engineer');
    const fp2 = computeFingerprint('Acme', 'Engineer', undefined);
    expect(fp1).toBe(fp2);
  });

  it('different jobs produce different fingerprints', () => {
    const fp1 = computeFingerprint('Acme', 'Engineer', 'NYC');
    const fp2 = computeFingerprint('Acme', 'Designer', 'NYC');
    expect(fp1).not.toBe(fp2);
  });

  it('normalizes remote location variants', () => {
    const fp1 = computeFingerprint('Acme', 'Engineer', 'Remote, USA');
    const fp2 = computeFingerprint('Acme', 'Engineer', 'Anywhere in the World');
    const fp3 = computeFingerprint('Acme', 'Engineer', '  remote ');
    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
  });

  it('same job from different sources produces same fingerprint', () => {
    const fp1 = computeFingerprint('Acme Corp', 'Senior Engineer', 'Remote');
    const fp2 = computeFingerprint('Acme Corp', 'Senior Engineer', 'Remote');
    expect(fp1).toBe(fp2);
  });
});
