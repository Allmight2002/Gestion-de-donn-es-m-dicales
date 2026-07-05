// @vitest-environment jsdom
// UI-1 : la coquille affiche une barre laterale par ROLE (navigation persistante), les bases
// recentes de l'utilisateur, et les reglages (theme/langue) ancres en bas.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/I18nProvider';
import { AuthProvider } from '../auth/AuthProvider';
import { RepositoryProvider } from '../data/RepositoryProvider';
import { AppShell } from './AppShell';
import { setOfflineUser } from '../data/offline';
import { recordRecentBase } from '../lib/recentBases';
import type { AuthBackend } from '../auth/backend';
import type { Profile, SessionUser } from '../auth/types';

function backendFor(profile: Profile): AuthBackend {
  const user: SessionUser = { id: profile.id, email: 'x@demo.test' };
  return {
    configured: true,
    async getSession() { return user; },
    onAuthChange() { return () => {}; },
    async signIn() {},
    async signOut() {},
    async fetchProfile() { return profile; },
    async sendPasswordReset() {},
    async updatePassword() {},
  } as unknown as AuthBackend;
}

function renderShell(profile: Profile) {
  return render(
    <I18nProvider>
      <AuthProvider backend={backendFor(profile)}>
        <RepositoryProvider>
          <MemoryRouter>
            <AppShell><p>CONTENU</p></AppShell>
          </MemoryRouter>
        </RepositoryProvider>
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('AppShell (UI-1, barre laterale)', () => {
  afterEach(() => {
    localStorage.clear();
    setOfflineUser(null);
  });

  test('medecin : navigation complete + bases recentes + profil en bas', async () => {
    setOfflineUser('u-med');
    recordRecentBase('b1', 'Gliomes 2026');
    renderShell({ id: 'u-med', fullName: 'Dr Mbassi', globalRole: 'medecin', language: 'fr' });

    expect(await screen.findByRole('link', { name: /Tableau de bord/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Groupes de recherche/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mes gabarits/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Synchronisation/ })).toBeInTheDocument();
    // Base recente de CE compte.
    expect(screen.getByRole('link', { name: /Gliomes 2026/ })).toBeInTheDocument();
    // Profil + deconnexion + contenu de la page.
    expect(screen.getByText('Dr Mbassi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
    expect(screen.getByText('CONTENU')).toBeInTheDocument();
  });

  test('curateur : navigation reduite (pool + synchro), pas de gabarits/groupes', async () => {
    renderShell({ id: 'u-cur', fullName: 'Curateur T', globalRole: 'curateur', language: 'fr' });
    expect(await screen.findByRole('link', { name: /Liste des requêtes/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Mes gabarits/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Groupes de recherche/ })).not.toBeInTheDocument();
  });
});
