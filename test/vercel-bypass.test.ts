import { describe, expect, test } from 'vitest';
import { safeBootstrapRedirect, validBypassBootstrapStatus } from '../e2e/vercel-bypass.setup';

describe('bootstrap du bypass Vercel', () => {
  test('accepte le succes direct et la redirection porteuse du cookie', () => {
    expect(validBypassBootstrapStatus(200)).toBe(true);
    expect(validBypassBootstrapStatus(307)).toBe(true);
  });

  test('refuse les reponses de protection ou les erreurs serveur', () => {
    expect(validBypassBootstrapStatus(401)).toBe(false);
    expect(validBypassBootstrapStatus(500)).toBe(false);
  });

  test('accepte une cible HTTPS sans identifiants et refuse les schemas dangereux', () => {
    const base = new URL('https://meddata-staging-example.vercel.app');
    expect(safeBootstrapRedirect('', base)).toBe(base);
    expect(safeBootstrapRedirect('https://vercel.com/bootstrap', base).protocol).toBe('https:');
    expect(() => safeBootstrapRedirect('http://vercel.com/bootstrap', base)).toThrow('HTTPS sure');
    expect(() => safeBootstrapRedirect('https://user:password@vercel.com/bootstrap', base)).toThrow('HTTPS sure');
  });
});
