// @vitest-environment jsdom
// UI-1 : la coquille affiche une barre laterale par ROLE (navigation persistante), les bases
// recentes de l'utilisateur, et les reglages (theme/langue) ancres en bas.
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../i18n/I18nProvider';
import { AuthProvider } from '../auth/AuthProvider';
import { RepositoryProvider } from '../data/RepositoryProvider';
import { AppShell } from './AppShell';
import { outbox, purgeAllOfflineData, setOfflineUser } from '../data/offline';
import { recordRecentBase } from '../lib/recentBases';
import type { AuthBackend } from '../auth/backend';
import type { Profile, SessionUser } from '../auth/types';

beforeAll(() => {
  vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  vi.stubEnv('VITE_OFFLINE_ADMIN_ACK', 'true');
});
afterAll(() => vi.unstubAllEnvs());

function backendFor(profile: Profile, onSignOut?: () => void): AuthBackend {
  const user: SessionUser = { id: profile.id, email: 'x@demo.test' };
  return {
    configured: true,
    async getSession() { return user; },
    onAuthChange() { return () => {}; },
    async signIn() {},
    async signOut() { onSignOut?.(); },
    async fetchProfile() { return profile; },
    async sendPasswordReset() {},
    async updatePassword() {},
  } as unknown as AuthBackend;
}

function renderShell(profile: Profile, onSignOut?: () => void) {
  localStorage.setItem('meddata:offline-cache-owner', profile.id);
  return render(
    <I18nProvider>
      <AuthProvider
        backend={backendFor(profile, onSignOut)}
        initializeOffline={async (userId) => {
          setOfflineUser(userId);
          return { previousOwner: userId, ownerChanged: false, recoveredSyncing: 0, errors: [] };
        }}
      >
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
    expect(screen.getByRole('link', { name: /Mes jeux de variables/ })).toBeInTheDocument();
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
    expect(screen.queryByRole('link', { name: /Mes jeux de variables/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Groupes de recherche/ })).not.toBeInTheDocument();
  });

  test('logout avec outbox vide se deconnecte sans confirmation', async () => {
    await purgeAllOfflineData();
    const signedOut = vi.fn();
    renderShell({ id: 'logout-empty', fullName: 'Dr Empty', globalRole: 'medecin', language: 'fr' }, signedOut);
    await screen.findByText('Dr Empty');
    await userEvent.click(screen.getByRole('button', { name: /Se d.connecter/ }));
    await waitFor(() => expect(signedOut).toHaveBeenCalledTimes(1));
  });

  test('logout avec outbox non vide avertit, permet d annuler puis exige la destruction explicite', async () => {
    await purgeAllOfflineData();
    const signedOut = vi.fn();
    renderShell({ id: 'logout-full', fullName: 'Dr Full', globalRole: 'medecin', language: 'fr' }, signedOut);
    await screen.findByText('Dr Full');
    await act(async () => {
      await outbox.put({
        id: 'logout-entry', dataType: 'analytic_outbox', baseId: 'b', patientId: 'p', encounterId: 'e', data: { score: 3 },
        reason: 'locale', validationStatus: 'draft', baseUpdatedAt: null, createdAt: Date.now(), expiresAt: Date.now() + 60_000,
        state: 'rejected', ownerUserId: 'logout-full', attemptCount: 1, lastError: 'permission denied',
      });
    });
    await waitFor(() => expect(screen.getAllByText('1').length).toBeGreaterThan(0));
    await userEvent.click(screen.getByRole('button', { name: /Se d.connecter/ }));
    expect(screen.getByRole('dialog', { name: 'Modifications locales non synchronisees' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(signedOut).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Se d.connecter/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Detruire et se deconnecter' }));
    await waitFor(() => expect(signedOut).toHaveBeenCalledTimes(1));
  });

  // D2 : le tiroir mobile est une modale (aria-modal). Sans verrou, la page defilait derriere,
  // la barre d'adresse mobile se repliait et un espace vide apparaissait sous le panneau.
  test('le tiroir mobile verrouille le defilement de la page puis le restaure', async () => {
    setOfflineUser('u-med');
    renderShell({ id: 'u-med', fullName: 'Dr Mbassi', globalRole: 'medecin', language: 'fr' });
    await screen.findByRole('link', { name: /Tableau de bord/ });
    expect(document.body.style.overflow).toBe('');

    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    await userEvent.click(screen.getByRole('button', { name: 'Fermer le menu' }));
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
  });
});
