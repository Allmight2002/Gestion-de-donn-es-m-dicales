import { describe, expect, test } from 'vitest';
import {
  createVercelStorageState,
  validatedVercelDeploymentHostname,
  vercelCookieHeaderFromStorageState,
} from '../scripts/vercel-cookie-state.mjs';

describe('bypass Vercel limite au staging', () => {
  const deployment = 'https://meddata-staging-example.vercel.app';
  const future = 2_000_000_000;
  const cookie = (domain = 'meddata-staging-example.vercel.app', secure = 'TRUE', expires = future) =>
    `#HttpOnly_${domain}\tFALSE\t/\t${secure}\t${expires}\t_vercel_jwt\tfictional-cookie`;

  test('valide uniquement un deploiement HTTPS vercel.app sans identifiants', () => {
    expect(validatedVercelDeploymentHostname(`${deployment}/path`)).toBe(
      'meddata-staging-example.vercel.app',
    );
    expect(() => validatedVercelDeploymentHostname('http://meddata-staging-example.vercel.app')).toThrow(
      'HTTPS',
    );
    expect(() =>
      validatedVercelDeploymentHostname('https://user:password@meddata-staging-example.vercel.app'),
    ).toThrow(
      'sans identifiants',
    );
    expect(() => validatedVercelDeploymentHostname('https://example.org')).toThrow('vercel.app');
  });

  test('produit un storage state avec un unique cookie exact, HttpOnly et Secure', () => {
    const jar = ['# Netscape HTTP Cookie File', cookie(), 'example.org\tFALSE\t/\tTRUE\t2000000000\tother\tx'].join(
      '\n',
    );
    const state = createVercelStorageState(jar, deployment, 1_900_000_000);

    expect(state.origins).toEqual([]);
    expect(state.cookies).toEqual([
      {
        name: '_vercel_jwt',
        value: 'fictional-cookie',
        domain: 'meddata-staging-example.vercel.app',
        path: '/',
        expires: future,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
    ]);
  });

  test('refuse un cookie hors domaine, non securise ou expire', () => {
    expect(() => createVercelStorageState(cookie('another-preview.vercel.app'), deployment)).toThrow(
      'staging exact',
    );
    expect(() => createVercelStorageState(cookie(undefined, 'FALSE'), deployment)).toThrow(
      'HttpOnly, Secure',
    );
    expect(() => createVercelStorageState(cookie(undefined, 'TRUE', 100), deployment, 101)).toThrow('expire');
  });

  test('produit un header de monitoring uniquement depuis un storage state exact et actuel', () => {
    const state = createVercelStorageState(cookie(), deployment, 1_900_000_000);
    expect(vercelCookieHeaderFromStorageState(state, deployment, 1_900_000_000)).toBe(
      '_vercel_jwt=fictional-cookie',
    );
    expect(() => vercelCookieHeaderFromStorageState({
      ...state,
      cookies: [{ ...state.cookies[0], value: 'value;injected=true' }],
    }, deployment, 1_900_000_000)).toThrow('invalide');
    expect(() => vercelCookieHeaderFromStorageState(state, 'https://other.vercel.app', 1_900_000_000))
      .toThrow('staging exact');
  });
});
