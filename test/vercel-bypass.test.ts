import { describe, expect, test } from 'vitest';
import { sanitizedHeadersForRequest, validatedStagingOrigin } from '../e2e/staging-test';

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

  test('conserve les headers seulement sur le staging exact et le controle SSO Vercel', () => {
    const origin = 'https://meddata-staging-example.vercel.app';
    const current = {
      Accept: 'text/html',
      'x-vercel-protection-bypass': 'test-secret',
      'x-vercel-set-bypass-cookie': 'true',
    };
    expect(sanitizedHeadersForRequest(`${origin}/login`, origin, current)).toBeUndefined();
    expect(
      sanitizedHeadersForRequest(
        `https://vercel.com/sso-api?url=${encodeURIComponent(`${origin}/login`)}&nonce=test`,
        origin,
        current,
      ),
    ).toBeUndefined();

    for (const url of [
      'https://gmsxrniiclrheehhoakn.supabase.co/rest/v1/profile',
      'https://vercel.com/login',
      'https://vercel.com/sso-api/other',
      'https://another-preview.vercel.app/',
      'not-a-url',
    ]) {
      const sanitized = sanitizedHeadersForRequest(url, origin, current);
      expect(sanitized).toContainEqual({ name: 'Accept', value: 'text/html' });
      expect(sanitized).not.toContainEqual(expect.objectContaining({ name: 'x-vercel-protection-bypass' }));
      expect(sanitized).not.toContainEqual(expect.objectContaining({ name: 'x-vercel-set-bypass-cookie' }));
    }
  });
});
