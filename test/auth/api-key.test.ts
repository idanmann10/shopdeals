import { describe, expect, it } from 'vitest';
import {
  generateRawKey,
  hashApiKey,
  parseAuthorizationHeader,
} from '../../src/auth/api-key.ts';

describe('hashApiKey', () => {
  it('is deterministic for the same input', () => {
    const a = hashApiKey('sk_live_abcdef');
    const b = hashApiKey('sk_live_abcdef');
    expect(a).toBe(b);
  });

  it('produces a 64-char hex string (sha256)', () => {
    const h = hashApiKey('sk_live_test');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'));
  });
});

describe('parseAuthorizationHeader', () => {
  it('returns unknown when header missing', () => {
    expect(parseAuthorizationHeader(undefined)).toEqual({ type: 'unknown' });
  });

  it('parses Bearer scheme case-insensitively', () => {
    expect(parseAuthorizationHeader('Bearer sk_live_xxx')).toEqual({
      type: 'bearer',
      token: 'sk_live_xxx',
    });
    expect(parseAuthorizationHeader('bearer sk_live_yyy')).toEqual({
      type: 'bearer',
      token: 'sk_live_yyy',
    });
    expect(parseAuthorizationHeader('BEARER sk_live_zzz')).toEqual({
      type: 'bearer',
      token: 'sk_live_zzz',
    });
  });

  it('returns unknown for non-Bearer schemes', () => {
    expect(parseAuthorizationHeader('Basic abc:def')).toEqual({ type: 'unknown' });
  });

  it('returns unknown for malformed headers', () => {
    expect(parseAuthorizationHeader('NoSpaceJustToken')).toEqual({ type: 'unknown' });
    expect(parseAuthorizationHeader('Bearer ')).toEqual({ type: 'unknown' });
  });
});

describe('generateRawKey', () => {
  it('produces sk_live_ prefix + 32 hex chars', () => {
    const key = generateRawKey();
    expect(key).toMatch(/^sk_live_[0-9a-f]{32}$/);
  });

  it('is non-deterministic', () => {
    const a = generateRawKey();
    const b = generateRawKey();
    expect(a).not.toBe(b);
  });
});
