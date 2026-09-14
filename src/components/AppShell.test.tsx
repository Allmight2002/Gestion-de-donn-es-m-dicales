// @vitest-environment jsdom
// UI-1 : la coquille affiche une barre laterale par ROLE (navigation persistante), les bases
// recentes de l'utilisateur, et les reglages (theme/langue) ancres en bas.
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
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

function renderShell(
  profile: Profile,
  onSignOut?: () => void,
  initialEntry = '/',
  children: ReactNode = <p>CONTENU</p>,
) {
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
          <MemoryRouter initialEntries={[initialEntry]}>
            <AppShell>{children}</AppShell>
          </MemoryRouter>
        </RepositoryProvider>
      </AuthProvider>
    </I18nProvider>,
  );
}

describe('AppShell (UI-1, barre laterale)', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setOfflineUser(null);
  });

  test('medecin : navigation complete + bases recentes + profil en bas', async () => {
    setOfflineUser('u-med');
    recordRecentBase('b1', 'Gliomes 2026');
    renderShell({ id: 'u-med', fullName: 'Dr Mbassi', globalRole: 'medecin', language: 'fr' });

    expect(await screen.findByRole('link', { name: /Tableau de bord/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Groupes de recherche/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mes jeux de variables/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Corbeille/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Synchronisation/ })).toBeInTheDocument();
    // Base recente de CE compte : elle est rendue apres la resolution asynchrone du profil.
    expect(await screen.findByRole('link', { name: /Gliomes 2026/ })).toBeInTheDocument();
    // Profil + deconnexion + contenu de la page.
    const profileName = screen.getByText('Dr Mbassi');
    expect(profileName).toBeInTheDocument();
    expect(profileName.closest('.surface-muted')).toBeInTheDocument();
    expect(screen.getByText('Médecin')).toHaveClass('font-medium', 'text-slate-600');
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument();
    expect(screen.getByText('CONTENU')).toBeInTheDocument();
    expect(screen.getByText('Ctrl K')).toHaveClass('text-slate-700');
  });

  test('la navigation defile dans une zone distincte du profil et des reglages', async () => {
    renderShell({ id: 'u-layout', fullName: 'Dr Layout', globalRole: 'medecin', language: 'fr' });

    await screen.findByText('Dr Layout');
    const sidebar = screen.getByRole('complementary');
    const navigation = sidebar.querySelector('nav[aria-label="Navigation principale"]');
    expect(navigation).not.toBeNull();
    const scrollRegion = navigation?.parentElement;
    expect(scrollRegion).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    const footer = scrollRegion?.nextElementSibling;
    expect(footer).toHaveClass('shrink-0');
    expect(footer).toContainElement(sidebar.querySelector('[aria-label="language"]'));
    expect(footer).toContainElement(sidebar.querySelector('[aria-label="Se déconnecter"]'));

    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir le menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Ouvrir le menu' });
    const drawerNavigation = drawer.querySelector('nav[aria-label="Navigation principale"]');
    expect(drawerNavigation).not.toBeNull();
    const drawerScrollRegion = drawerNavigation?.parentElement;
    expect(drawerScrollRegion).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
    const drawerFooter = drawerScrollRegion?.nextElementSibling;
    expect(drawerFooter).toHaveClass('shrink-0');
    expect(drawerFooter).toContainElement(drawer.querySelector('[aria-label="language"]'));
    expect(drawerFooter).toContainElement(drawer.querySelector('[aria-label="Se déconnecter"]'));
  });

  test('l editeur peut masquer la barre laterale, regagne la largeur et conserve la saisie', async () => {
    const user = userEvent.setup();
    renderShell(
      { id: 'u-editor', fullName: 'Dr Editor', globalRole: 'medecin', language: 'fr' },
      undefined,
      '/bases/base-editor/template',
      <label>Valeur en cours <input defaultValue="saisie preservee" /></label>,
    );

    await screen.findByText('Dr Editor');
    const sidebar = screen.getByRole('complementary');
    const contentColumn = screen.getByRole('main').parentElement;
    const input = screen.getByRole('textbox', { name: 'Valeur en cours' });
    const editorHeader = document.querySelector('header');
    expect(sidebar).toHaveClass('lg:flex');
    expect(contentColumn).toHaveClass('lg:pl-60');
    expect(editorHeader).toHaveClass('relative');
    expect(editorHeader).not.toHaveClass('sticky');

    await user.click(screen.getByRole('button', { name: 'Masquer la barre latérale' }));

    expect(sidebar).toHaveClass('lg:hidden');
    // La gouttiere laissee libre est celle du bouton de reouverture, pas la largeur de la barre.
    expect(contentColumn).toHaveClass('lg:pl-20');
    expect(input).toHaveValue('saisie preservee');
    expect(sessionStorage.getItem('meddata:desktop-sidebar')).toBe('closed');
    expect(screen.getByRole('button', { name: 'Afficher la barre latérale' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Afficher la barre latérale' }));
    expect(sidebar).toHaveClass('lg:flex');
    expect(contentColumn).toHaveClass('lg:pl-60');
    expect(input).toHaveValue('saisie preservee');
    expect(screen.getByRole('button', { name: 'Masquer la barre latérale' })).toBeInTheDocument();

    // Le changement de route garde l état du shell et le footer de l aside reste ancré.
    await user.click(screen.getByRole('link', { name: /Groupes de recherche/ }));
    expect(sidebar).toHaveClass('lg:flex');
    expect(input).toHaveValue('saisie preservee');
    const navigation = sidebar.querySelector('nav[aria-label="Navigation principale"]');
    const scrollRegion = navigation?.parentElement;
    expect(scrollRegion?.nextElementSibling).toHaveClass('shrink-0');
    expect(scrollRegion?.nextElementSibling).toContainElement(sidebar.querySelector('[aria-label="language"]'));
    expect(scrollRegion?.nextElementSibling).toContainElement(sidebar.querySelector('[aria-label="Se déconnecter"]'));
  });

  test('la preference de barre laterale est restauree a la navigation suivante', async () => {
    sessionStorage.setItem('meddata:desktop-sidebar', 'closed');
    renderShell({ id: 'u-persist', fullName: 'Dr Persist', globalRole: 'medecin', language: 'fr' });

    await screen.findByText('Dr Persist');
    expect(screen.getByRole('complementary')).toHaveClass('lg:hidden');
    expect(screen.getByRole('button', { name: 'Afficher la barre latérale' })).toBeInTheDocument();
  });

  test('le parcours editeur sous /templates garde aussi l entete mobile dans le flux', async () => {
    renderShell({ id: 'u-templates', fullName: 'Dr Templates', globalRole: 'medecin', language: 'fr' }, undefined, '/templates');

    await screen.findByText('Dr Templates');
    const header = document.querySelector('header');
    expect(header).toHaveClass('relative');
    expect(header).not.toHaveClass('sticky', 'top-0');
  });

  test('curateur : navigation reduite (pool + synchro), pas de gabarits/groupes', async () => {
    renderShell({ id: 'u-cur', fullName: 'Curateur T', globalRole: 'curateur', language: 'fr' });
    expect(await screen.findByRole('link', { name: /Liste des requêtes/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Mes jeux de variables/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Groupes de recherche/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Corbeille/ })).not.toBeInTheDocument();
  });

  test('saisisseur : barre laterale limitee au tableau de bord et a la synchronisation', async () => {
    renderShell({ id: 'u-mission', fullName: 'Saisie Fictive', globalRole: 'saisisseur', language: 'fr' });
    expect(await screen.findByRole('link', { name: /Tableau de bord/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Synchronisation/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Groupes de recherche/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Mes jeux de variables/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Comptes de mission/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Corbeille/ })).not.toBeInTheDocument();
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
    expect(screen.getByRole('dialog', { name: 'Ouvrir le menu' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.body.style.overflow).toBe(''));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
