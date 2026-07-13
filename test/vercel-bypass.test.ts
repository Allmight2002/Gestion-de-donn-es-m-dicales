import { describe, expect, test } from 'vitest';
import { sameDeploymentRedirect } from '../e2e/vercel-bypass.setup';

describe('redirection du bypass Vercel', () => {
  const base = new URL('https://meddata-staging-example.vercel.app');

  test('accepte seulement une redirection relative ou absolue sur le meme deploiement HTTPS', () => {
    expect(sameDeploymentRedirect('/?set-bypass-cookie=1', base).href)
      .toBe('https://meddata-staging-example.vercel.app/?set-bypass-cookie=1');
    expect(sameDeploymentRedirect('https://meddata-staging-example.vercel.app/', base).hostname)
      .toBe(base.hostname);
  });

  test('refuse toute propagation vers une autre origine ou vers HTTP', () => {
    expect(() => sameDeploymentRedirect('https://attacker.example/', base)).toThrow('quitte le deploiement');
    expect(() => sameDeploymentRedirect('http://meddata-staging-example.vercel.app/', base)).toThrow('quitte le deploiement');
    expect(() => sameDeploymentRedirect('', base)).toThrow('redirection');
  });
});
