// @vitest-environment jsdom
// Test de rendu du gating par role (cahier §7) avec un backend d'auth INJECTE
// (aucun reseau, aucun Supabase requis).
import 'fake-indexeddb/auto';
import { useContext } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { I18nProvider } from '../i18n/I18nProvider';
import { AuthContext, AuthProvider } from './AuthProvider';
import { AppRoutes } from '../routes/AppRoutes';
import type { AuthBackend } from './backend';
import type { Profile, SessionUser } from './types';
import {
  buildSnapshot, getOfflineUser, initializeOfflineForUser, offlineCache, outbox, purgeAllOfflineData, setOfflineUser,
} from '../data/offline';
import { isPwaRegistrationAllowed, setPwaRegistrationAllowed } from '../pwa/registrationPolicy';

beforeAll(() => {
  vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  vi.stubEnv('VITE_OFFLINE_ADMIN_ACK', 'true');
});
afterAll(() => vi.unstubAllEnvs());

const setNavigatorOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
};

afterEach(() => {
  setPwaRegistrationAllowed(false);
  setNavigatorOnline(true);
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i) ?? '';
    if (key.startsWith('meddata:offline-profile:')) localStorage.removeItem(key);
  }
});

function fakeBackend(init: { user: SessionUser | null; profile: Profile | null }): AuthBackend {
  let user = init.user;
  const listeners = new Set<(u: SessionUser | null) => void>();
  return {
    configured: true,
    async getSession() {
      return user;
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async signIn(email) {
      user = init.user ?? { id: 'u', email };
      listeners.forEach((l) => l(user));
    },
    async signOut() {
      user = null;
      listeners.forEach((l) => l(null));
    },
    async fetchProfile() {
      return init.profile;
    },
    async sendPasswordReset() {},
    async updatePassword() {},
  };
}

const adminProfile: Profile = { id: 's', fullName: 'Admin', globalRole: 'system_admin', language: 'fr' };
const memberProfile: Profile = { id: 'm', fullName: 'Medecin', globalRole: 'medecin', language: 'fr' };
const curatorProfile: Profile = { id: 'c', fullName: 'Curateur', globalRole: 'curateur', language: 'fr' };

function renderApp(backend: AuthBackend) {
  return render(
    <I18nProvider>
      <AuthProvider
        backend={backend}
        initializeOffline={async (userId) => {
          setOfflineUser(userId);
          return { previousOwner: userId, ownerChanged: false, recoveredSyncing: 0, errors: [] };
        }}
      >
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>,
  );
}

function AuthProbe() {
  const auth = useContext(AuthContext)!;
  return (
    <div>
      <p data-testid="auth-state">{auth.status}:{auth.user?.id ?? 'none'}</p>
      <p data-testid="profile-state">{auth.profile ? `${auth.profile.globalRole}:${auth.profile.fullName || 'minimal'}` : 'none'}</p>
      {auth.error && <p role="alert">{auth.error}</p>}
      <button type="button" onClick={() => void auth.signOut()}>Force sign out</button>
    </div>
  );
}

function renderAuthProbe(backend: AuthBackend) {
  return render(
    <I18nProvider>
      <AuthProvider
        backend={backend}
        initializeOffline={async (userId) => {
          setOfflineUser(userId);
          return { previousOwner: userId, ownerChanged: false, recoveredSyncing: 0, errors: [] };
        }}
      >
        <AuthProbe />
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('gating par role', () => {
  test('non connecte -> ecran de connexion', async () => {
    renderApp(fakeBackend({ user: null, profile: null }));
    expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
  });

  // UI-1 : le libelle apparait aussi dans la barre laterale -> on vise le TITRE de page (heading).
  test('connecte system_admin -> administration des gabarits', async () => {
    renderApp(fakeBackend({ user: { id: 's', email: 's@demo.test' }, profile: adminProfile }));
    expect(await screen.findByRole('heading', { name: 'Administration des modèles' }, { timeout: 5000 })).toBeInTheDocument();
  });

  test('connecte membre -> tableau de bord', async () => {
    renderApp(fakeBackend({ user: { id: 'm', email: 'm@demo.test' }, profile: memberProfile }));
    expect(await screen.findByRole('heading', { name: 'Tableau de bord' }, { timeout: 5000 })).toBeInTheDocument();
  });

  test('autorise le worker apres initialisation puis le desarme avant logout', async () => {
    renderAuthProbe(fakeBackend({ user: { id: 'm', email: 'm@demo.test' }, profile: memberProfile }));
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed_in:m'));
    expect(isPwaRegistrationAllowed()).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Force sign out' }));
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed_out:none'));
    expect(isPwaRegistrationAllowed()).toBe(false);
  });

  test('le fallback hors-ligne ne conserve qu un marqueur medecin minimal et borne', async () => {
    setNavigatorOnline(true);
    renderAuthProbe(fakeBackend({ user: { id: 'm', email: 'm@demo.test' }, profile: memberProfile }));
    await waitFor(() => expect(screen.getByTestId('profile-state')).toHaveTextContent('medecin:Medecin'));

    const marker = JSON.parse(localStorage.getItem('meddata:offline-profile:m') ?? '{}') as Record<string, unknown>;
    expect(marker).toMatchObject({ version: 1, userId: 'm', globalRole: 'medecin', language: 'fr' });
    expect(marker.expiresAt).toEqual(expect.any(Number));
    expect(marker).not.toHaveProperty('fullName');
    expect(marker).not.toHaveProperty('email');
    expect(marker).not.toHaveProperty('token');
  });

  test('un profil serveur inaccessible reste ferme en ligne malgre le marqueur local', async () => {
    localStorage.setItem('meddata:offline-profile:m', JSON.stringify({
      version: 1, userId: 'm', globalRole: 'medecin', language: 'fr', expiresAt: Date.now() + 60_000,
    }));
    setNavigatorOnline(true);
    const backend = {
      ...fakeBackend({ user: { id: 'm', email: 'm@demo.test' }, profile: memberProfile }),
      async fetchProfile() { throw new Error('Supabase inaccessible'); },
    };
    renderAuthProbe(backend);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed_in:m'));
    expect(screen.getByTestId('profile-state')).toHaveTextContent('none');
  });

  test('un refresh hors-ligne reutilise le marqueur minimal puis reconcilie le profil au retour reseau', async () => {
    localStorage.setItem('meddata:offline-profile:m', JSON.stringify({
      version: 1, userId: 'm', globalRole: 'medecin', language: 'fr', expiresAt: Date.now() + 60_000,
    }));
    let offline = true;
    setNavigatorOnline(false);
    const backend = {
      ...fakeBackend({ user: { id: 'm', email: 'm@demo.test' }, profile: memberProfile }),
      async fetchProfile() {
        if (offline) throw new Error('offline');
        return memberProfile;
      },
    };
    renderAuthProbe(backend);
    await waitFor(() => expect(screen.getByTestId('profile-state')).toHaveTextContent('medecin:minimal'));

    offline = false;
    setNavigatorOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(screen.getByTestId('profile-state')).toHaveTextContent('medecin:Medecin'));
  });

  test('un marqueur hors-ligne expire est refuse et supprime', async () => {
    localStorage.setItem('meddata:offline-profile:m', JSON.stringify({
      version: 1, userId: 'm', globalRole: 'medecin', language: 'fr', expiresAt: Date.now() - 1,
    }));
    setNavigatorOnline(false);
    const backend = {
      ...fakeBackend({ user: { id: 'm', email: 'm@demo.test' }, profile: memberProfile }),
      async fetchProfile() { throw new Error('offline'); },
    };
    renderAuthProbe(backend);
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed_in:m'));
    expect(screen.getByTestId('profile-state')).toHaveTextContent('none');
    expect(localStorage.getItem('meddata:offline-profile:m')).toBeNull();
  });

  test('un curateur ne peut pas ouvrir directement l export d une cohorte', async () => {
    window.history.replaceState({}, '', '/bases/b1/cohorts/c1/export');
    renderApp(fakeBackend({ user: { id: 'c', email: 'c@demo.test' }, profile: curatorProfile }));
    await waitFor(() => expect(window.location.pathname).toBe('/curation'));
    expect(screen.queryByRole('heading', { name: /Exporter une cohorte/i })).not.toBeInTheDocument();
    window.history.replaceState({}, '', '/');
  });

  test('deconnexion -> retour a l ecran de connexion', async () => {
    renderApp(fakeBackend({ user: { id: 'm', email: 'm@demo.test' }, profile: memberProfile }));
    await screen.findByRole('heading', { name: 'Tableau de bord' });
    expect(localStorage.getItem('meddata:offline-profile:m')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
    expect(localStorage.getItem('meddata:offline-profile:m')).toBeNull();
  });
  test('ignore une reponse profil arrivee apres deconnexion', async () => {
    let user: SessionUser | null = { id: 'm', email: 'm@demo.test' };
    let resolveProfile: ((profile: Profile | null) => void) | null = null;
    const listeners = new Set<(u: SessionUser | null) => void>();
    const backend: AuthBackend = {
      configured: true,
      async getSession() {
        return user;
      },
      onAuthChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      async signIn() {},
      async signOut() {
        user = null;
        listeners.forEach((l) => l(null));
      },
      async fetchProfile() {
        return new Promise<Profile | null>((resolve) => {
          resolveProfile = resolve;
        });
      },
      async sendPasswordReset() {},
      async updatePassword() {},
    };

    render(
      <I18nProvider>
        <AuthProvider backend={backend}>
          <AuthProbe />
        </AuthProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(resolveProfile).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Force sign out' }));
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed_out:none'));

    await act(async () => {
      resolveProfile?.(memberProfile);
      await Promise.resolve();
    });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('signed_out:none');
  });

  test('montage neuf A vers B purge toutes les donnees avant d activer le cache de B', async () => {
    await purgeAllOfflineData();
    expect((await initializeOfflineForUser('fresh-A')).errors).toHaveLength(0);
    await offlineCache.save(buildSnapshot(
      { id: 'fresh-base-A', name: 'A', templateVersionId: null }, [], {}, [], Date.now(),
    ));
    await outbox.put({
      id: 'fresh-outbox-A', dataType: 'analytic_outbox', baseId: 'fresh-base-A', patientId: 'pA', encounterId: 'eA',
      data: { score: 1 }, reason: 'A', validationStatus: 'draft', baseUpdatedAt: null,
      createdAt: Date.now(), expiresAt: Date.now() + 60_000, state: 'pending', ownerUserId: 'fresh-A',
    });
    setOfflineUser(null); // nouveau chargement du module : plus d ancien utilisateur en memoire

    render(
      <I18nProvider>
        <AuthProvider backend={fakeBackend({ user: { id: 'fresh-B', email: 'b@demo.test' }, profile: memberProfile })}>
          <AuthProbe />
        </AuthProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed_in:fresh-B'));
    expect(localStorage.getItem('meddata:offline-cache-owner')).toBe('fresh-B');
    expect(await offlineCache.get('fresh-base-A')).toBeNull();
    expect(await outbox.count()).toBe(0);
    await purgeAllOfflineData();
    setOfflineUser(null);
  });

  test('une purge inter-comptes partielle est remontee a l interface et bloque le cache', async () => {
    render(
      <I18nProvider>
        <AuthProvider
          backend={fakeBackend({ user: { id: 'purge-B', email: 'b@demo.test' }, profile: memberProfile })}
          initializeOffline={async () => ({ previousOwner: 'purge-A', ownerChanged: true, recoveredSyncing: 0, errors: ['IndexedDB bloquee'] })}
        >
          <AuthProbe />
        </AuthProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed_in:purge-B'));
    expect(screen.getByRole('alert')).toHaveTextContent(/Purge locale incomplete.*IndexedDB bloquee/i);
    expect(isPwaRegistrationAllowed()).toBe(false);
  });

  test('une purge partielle conserve l ancien proprietaire pour imposer une nouvelle tentative', async () => {
    localStorage.setItem('meddata:offline-cache-owner', 'owner-A');
    const report = await initializeOfflineForUser('owner-B', {
      purgeAll: async () => ({
        indexedDb: false, localStorage: true, cacheStorage: true, serviceWorkers: true,
        errors: ['IndexedDB bloquee'],
      }),
    });
    expect(report.ownerChanged).toBe(true);
    expect(report.errors).toContain('IndexedDB bloquee');
    expect(localStorage.getItem('meddata:offline-cache-owner')).toBe('owner-A');
    expect(getOfflineUser()).toBeNull();
  });
});
