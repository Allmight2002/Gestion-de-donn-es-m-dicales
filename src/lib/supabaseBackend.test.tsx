// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeSupabaseBackend } from './supabaseBackend';

afterEach(() => localStorage.clear());

const clientWithAuth = (auth: Record<string, unknown>) => ({ auth }) as unknown as SupabaseClient;

describe('makeSupabaseBackend signOut', () => {
  test('conserve le logout Supabase nominal lorsque le serveur repond', async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    const backend = makeSupabaseBackend(clientWithAuth({ signOut }));

    await backend.signOut();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith();
  });

  test('efface la session persistante puis notifie auth-js si le logout serveur echoue', async () => {
    const key = 'sb-staging-auth-token';
    localStorage.setItem(key, 'session-secrete-fictive');
    localStorage.setItem(`${key}-code-verifier`, 'verifier-fictif');
    localStorage.setItem(`${key}-user`, 'profil-fictif');
    const signOut = vi.fn()
      .mockResolvedValueOnce({ error: new Error('Failed to fetch') })
      .mockImplementationOnce(async (options) => {
        expect(options).toEqual({ scope: 'local' });
        expect(localStorage.getItem(key)).toBeNull();
        return { error: null };
      });
    const backend = makeSupabaseBackend(clientWithAuth({ signOut, storageKey: key }));

    await backend.signOut();

    expect(signOut).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(`${key}-code-verifier`)).toBeNull();
    expect(localStorage.getItem(`${key}-user`)).toBeNull();
  });

  test('efface aussi la session quand le fetch de logout leve une exception', async () => {
    const key = 'sb-staging-auth-token';
    localStorage.setItem(key, 'session-secrete-fictive');
    const signOut = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ error: null });
    const backend = makeSupabaseBackend(clientWithAuth({ signOut, storageKey: key }));

    await backend.signOut();

    expect(signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    expect(localStorage.getItem(key)).toBeNull();
  });
});

describe('makeSupabaseBackend signIn', () => {
  test('traduit un identifiant de mission vers l identite Auth technique', async () => {
    const signInWithPassword = vi.fn(async () => ({ error: null }));
    const backend = makeSupabaseBackend(clientWithAuth({ signInWithPassword }));

    await backend.signIn(' Mission-Neuro-01 ', 'mot-de-passe-fictif');

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'mission-neuro-01@mission.meddata.invalid',
      password: 'mot-de-passe-fictif',
    });
  });

  test('conserve la connexion email des comptes ordinaires', async () => {
    const signInWithPassword = vi.fn(async () => ({ error: null }));
    const backend = makeSupabaseBackend(clientWithAuth({ signInWithPassword }));

    await backend.signIn(' Medecin@Example.TEST ', 'mot-de-passe-fictif');

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'medecin@example.test',
      password: 'mot-de-passe-fictif',
    });
  });
});
