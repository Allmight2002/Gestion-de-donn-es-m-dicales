// @vitest-environment jsdom
// La page de base en ONGLETS — fil d'Ariane, quatre destinations selon le role/permissions,
// sous-onglets du groupe actif, contenu enfant rendu via Outlet.
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseLayout } from './BaseLayout';
import type { BaseRepository, BaseListing } from '../../data/bases';

const NO_PERMS = { canViewIdentity: false, canViewRawDocuments: false, canEditStructuredData: false, canExportData: false, canManageAccess: false };

function listingWith(
  role: 'owner' | 'viewer',
  perms: Partial<typeof NO_PERMS> = {},
  extra: Partial<BaseListing> = {},
): BaseListing {
  return {
    base: { id: 'b1', name: 'Gliomes 2026', specialty: 'Neuro', ownerUserId: 'u', currentTemplateVersionId: 'v1' },
    role,
    permissions: { ...NO_PERMS, ...perms },
    templateName: 'T', versionNumber: 1,
    ...extra,
  };
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

function renderLayout(listing: BaseListing) {
  const bases = { async getBase() { return listing; } } as unknown as BaseRepository;
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases}>
        <MemoryRouter initialEntries={['/bases/b1']}>
          <Routes>
            <Route path="/bases/:id" element={<BaseLayout />}>
              <Route index element={<div>HOME</div>} />
              <Route path="parametres" element={<div>REGLAGES</div>} />
              <Route path="queue" element={<div>FILE</div>} />
              <Route path="cohorts" element={<div>COHORTES</div>} />
              <Route path="stats" element={<div>STATS</div>} />
              <Route path="activity" element={<div>JOURNAL</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

// Le regroupement ne donne acces a rien de nouveau : chaque entree garde la condition
// d'affichage de son ecran, et un groupe sans entree disponible disparait.
describe('BaseLayout — quatre destinations', () => {
  test('proprietaire : Patients, A completer, Analyse, Parametres — et rien de plus', async () => {
    renderLayout(listingWith('owner'));
    const nav = await screen.findByRole('navigation', { name: 'Gliomes 2026' });
    expect(Array.from(nav.querySelectorAll('a'), (link) => link.textContent))
      .toEqual(['Patients', 'À compléter', 'Analyse', 'Paramètres']);
    expect(screen.getByText('Gliomes 2026')).toBeInTheDocument(); // fil d'Ariane
    expect(screen.getByText('HOME')).toBeInTheDocument(); // enfant (Outlet)
  });

  test('l onglet Parametres ouvre les reglages et deplie ses sous-onglets', async () => {
    renderLayout(listingWith('owner'));
    await userEvent.click(await screen.findByRole('link', { name: /Paramètres/ }));
    expect(await screen.findByText('REGLAGES')).toBeInTheDocument();
    const subs = screen.getByRole('navigation', { name: 'Paramètres' });
    expect(Array.from(subs.querySelectorAll('a'), (link) => link.textContent))
      .toEqual(['Général', 'Variables', 'Accès', 'Journal']);
  });

  test('le journal et les statistiques restent accessibles a un lecteur, ranges dans leur groupe', async () => {
    renderLayout(listingWith('viewer'));
    const nav = await screen.findByRole('navigation', { name: 'Gliomes 2026' });
    expect(Array.from(nav.querySelectorAll('a'), (link) => link.textContent))
      .toEqual(['Patients', 'Analyse', 'Paramètres']); // ni saisie a completer, ni curation
    await userEvent.click(screen.getByRole('link', { name: /Paramètres/ }));
    const subs = await screen.findByRole('navigation', { name: 'Paramètres' });
    expect(Array.from(subs.querySelectorAll('a'), (link) => link.textContent)).toEqual(['Général', 'Journal']);
    expect(screen.queryByRole('link', { name: 'Variables' })).not.toBeInTheDocument();
  });

  test('un seul sous-onglet disponible : pas de barre secondaire', async () => {
    renderLayout(listingWith('viewer'));
    await userEvent.click(await screen.findByRole('link', { name: /Analyse/ }));
    expect(await screen.findByText('STATS')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Analyse' })).not.toBeInTheDocument();
  });
});

// Compte de mission : parcours reduit a la saisie + bandeau d'echeance permanent
// (docs/spec-comptes-mission.md §8).
describe('BaseLayout — compte de mission', () => {
  test('le bandeau annonce l echeance et le parcours se limite a la saisie', async () => {
    renderLayout(listingWith('viewer', {}, { expiresAt: inDays(120), canCreateStructuredData: true }));
    expect(await screen.findByText(/Mission sur cette base jusqu/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Gliomes 2026' });
    expect(Array.from(nav.querySelectorAll('a'), (link) => link.textContent)).toEqual(['Patients']);
  });

  test('a l approche de l echeance, le bandeau compte les jours restants', async () => {
    renderLayout(listingWith('viewer', {}, { expiresAt: inDays(5), canCreateStructuredData: true }));
    expect(await screen.findByText(/il reste 5 jour/)).toBeInTheDocument();
  });

  test('un acces permanent n affiche aucun bandeau de mission', async () => {
    renderLayout(listingWith('viewer'));
    await screen.findByRole('link', { name: /Patients/ });
    expect(screen.queryByText(/Mission sur cette base/)).not.toBeInTheDocument();
  });
});
