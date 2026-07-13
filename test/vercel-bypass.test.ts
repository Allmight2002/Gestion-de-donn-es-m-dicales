import { describe, expect, test } from 'vitest';
import { bypassHeadersForRequest, validatedStagingOrigin } from '../e2e/staging-test';

describe('bypass Vercel limite au staging', () => {
  test('valide uniquement une origine HTTPS vercel.app sans identifiants', () => {
    expect(validatedStagingOrigin('https://meddata-staging-example.vercel.app/path')).toBe(
      'https://meddata-staging-example.vercel.app',
    );
    expect(() => validatedStagingOrigin('http://meddata-staging-example.vercel.app')).toThrow('HTTPS');
    expect(() => validatedStagingOrigin('https://user:password@meddata-staging-example.vercel.app')).toThrow(
      'sans identifiants',
    );
    expect(() => validatedStagingOrigin('https://example.org')).toThrow('vercel.app');
  });

  test('ajoute le secret seulement a l origine staging exacte', () => {
    const origin = 'https://meddata-staging-example.vercel.app';
    const headers = bypassHeadersForRequest(`${origin}/login`, origin, { Accept: 'text/html' }, 'test-secret');
    expect(headers).toContainEqual({ name: 'Accept', value: 'text/html' });
    expect(headers).toContainEqual({ name: 'x-vercel-protection-bypass', value: 'test-secret' });

    expect(
      bypassHeadersForRequest('https://gmsxrniiclrheehhoakn.supabase.co/rest/v1/profile', origin, {}, 'test-secret'),
    ).toBeUndefined();
    expect(
      bypassHeadersForRequest('https://vercel.com/sso-api', origin, {}, 'test-secret'),
    ).toBeUndefined();
    expect(
      bypassHeadersForRequest('https://another-preview.vercel.app/', origin, {}, 'test-secret'),
    ).toBeUndefined();
  });
});
