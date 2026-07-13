import { describe, expect, test } from 'vitest';
import { validBypassBootstrapStatus } from '../e2e/vercel-bypass.setup';

describe('bootstrap du bypass Vercel', () => {
  test('accepte le succes direct et la redirection porteuse du cookie', () => {
    expect(validBypassBootstrapStatus(200)).toBe(true);
    expect(validBypassBootstrapStatus(307)).toBe(true);
  });

  test('refuse les reponses de protection ou les erreurs serveur', () => {
    expect(validBypassBootstrapStatus(401)).toBe(false);
    expect(validBypassBootstrapStatus(500)).toBe(false);
  });
});
