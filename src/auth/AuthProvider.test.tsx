// @vitest-environment jsdom
// Test de rendu du gating par role (cahier §7) avec un backend d'auth INJECTE
// (aucun reseau, aucun Supabase requis).
import { useContext } from 'react';
import { describe, expect, test } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/I18nProvider';
import { AuthContext, AuthProvider } from './AuthProvider';
import { AppRoutes } from '../routes/AppRoutes';
import type { AuthBackend } from './backend';
import type { Profile, SessionUser } from './types';

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

function renderApp(backend: AuthBackend) {
  return render(
    <I18nProvider>
      <AuthProvider backend={backend}>
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
      <button type="button" onClick={() => void auth.signOut()}>Force sign out</button>
    </div>
  );
}

describe('gating par role', () => {
  test('non connecte -> ecran de connexion', async () => {
    renderApp(fakeBackend({ user: null, profile: null }));
    expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
  });

  test('connecte system_admin -> administration des gabarits', async () => {
    renderApp(fakeBackend({ user: { id: 's', email: 's@demo.test' }, profile: adminProfile }));
    expect(await screen.findByText('Administration des gabarits')).toBeInTheDocument();
  });

  test('connecte membre -> tableau de bord', async () => {
    renderApp(fakeBackend({ user: { id: 'm', email: 'm@demo.test' }, profile: memberProfile }));
    expect(await screen.findByText('Tableau de bord')).toBeInTheDocument();
  });

  test('deconnexion -> retour a l ecran de connexion', async () => {
    renderApp(fakeBackend({ user: { id: 'm', email: 'm@demo.test' }, profile: memberProfile }));
    await screen.findByText('Tableau de bord');
    await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(await screen.findByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
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
    expect(await screen.findByTestId('auth-state')).toHaveTextContent('signed_out:none');

    await act(async () => {
      resolveProfile?.(memberProfile);
      await Promise.resolve();
    });
    expect(screen.getByTestId('auth-state')).toHaveTextContent('signed_out:none');
  });
});
