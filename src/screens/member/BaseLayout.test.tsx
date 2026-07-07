// @vitest-environment jsdom
// UI-1 : la page de base en ONGLETS — fil d'Ariane, onglets selon le role/permissions,
// contenu enfant rendu via Outlet, navigation par onglet.
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseLayout } from './BaseLayout';
import type { BaseRepository, BaseListing } from '../../data/bases';

const NO_PERMS = { canViewIdentity: false, canViewRawDocuments: false, canEditStructuredData: false, canExportData: false, canManageAccess: false };

function listingWith(role: 'owner' | 'viewer', perms: Partial<typeof NO_PERMS> = {}): BaseListing {
  return {
    base: { id: 'b1', name: 'Gliomes 2026', specialty: 'Neuro', ownerUserId: 'u', currentTemplateVersionId: 'v1' },
    role,
    permissions: { ...NO_PERMS, ...perms },
    templateName: 'T', versionNumber: 1,
  };
}

function renderLayout(listing: BaseListing) {
  const bases = { async getBase() { return listing; } } as unknown as BaseRepository;
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases}>
        <MemoryRouter initialEntries={['/bases/b1']}>
          <Routes>
            <Route path="/bases/:id" element={<BaseLayout />}>
              <Route index element={<div>HOME</div>} />
              <Route path="import" element={<div>IMPORT</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('BaseLayout (UI-1, onglets)', () => {
  test('proprietaire : tous les onglets + fil d Ariane + Outlet ; naviguer vers Importer', async () => {
    renderLayout(listingWith('owner'));
    expect(await screen.findByRole('link', { name: /Importer/ })).toBeInTheDocument();
    for (const label of ['Patients', 'Cohortes', 'Journal', 'Accès', 'Variables', 'Curation']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByText('Gliomes 2026')).toBeInTheDocument(); // fil d'Ariane
    expect(screen.getByText('HOME')).toBeInTheDocument(); // enfant (Outlet)

    await userEvent.click(screen.getByRole('link', { name: /Importer/ }));
    expect(await screen.findByText('IMPORT')).toBeInTheDocument();
  });

  test('lecteur sans permissions : Patients + Journal seulement', async () => {
    renderLayout(listingWith('viewer'));
    expect(await screen.findByRole('link', { name: /Journal/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Patients/ })).toBeInTheDocument();
    for (const label of ['Importer', 'Cohortes', 'Accès', 'Variables', 'Curation']) {
      expect(screen.queryByRole('link', { name: new RegExp(label) })).not.toBeInTheDocument();
    }
  });
});
