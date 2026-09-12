// @vitest-environment jsdom
// A5 : la palette de recherche (Ctrl+K) liste les bases, filtre et navigue.
import { describe, expect, test } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../i18n/I18nProvider';
import { RepositoryProvider } from '../data/RepositoryProvider';
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider';
import { CommandPalette, OPEN_PALETTE_EVENT } from './CommandPalette';
import type { BaseRepository, BaseListing } from '../data/bases';

const listing = (id: string, name: string, specialty: string | null): BaseListing => ({
  base: { id, name, specialty, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner',
  permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
  templateName: 'T', versionNumber: 1,
});
const baseRepo = {
  async listMyBases() { return [listing('b1', 'Gliomes 2026', 'Neuro'), listing('b2', 'Méningiomes', 'Neuro')]; },
} as unknown as BaseRepository;
const auth = { profile: { globalRole: 'medecin' } } as unknown as AuthContextValue;

function renderPalette() {
  return render(
    <I18nProvider>
      <AuthContext.Provider value={auth}>
        <RepositoryProvider bases={baseRepo}>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<CommandPalette />} />
              <Route path="/bases/:id" element={<div>BASE PAGE</div>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </AuthContext.Provider>
    </I18nProvider>,
  );
}

describe('CommandPalette (A5)', () => {
  test('Ctrl+K ouvre la palette, filtre les bases et navigue', async () => {
    renderPalette();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true }); // ouvre
    expect(await screen.findByText('Gliomes 2026')).toBeInTheDocument();
    expect(screen.getByText('Méningiomes')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/Rechercher une base/), 'Glio'); // filtre
    expect(screen.queryByText('Méningiomes')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Gliomes 2026')); // ouvre la base
    expect(await screen.findByText('BASE PAGE')).toBeInTheDocument();
  });

  test('l evenement d ouverture (bouton d en-tete) ouvre aussi la palette', async () => {
    renderPalette();
    act(() => { window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)); });
    expect(await screen.findByPlaceholderText(/Rechercher une base/)).toBeInTheDocument();
  });

  // UX-12(a) : la palette ne memorise plus une liste chargee une seule fois, ni un echec
  // transforme en « aucune base », et ne propose que des destinations ouvertes au role.
  function renderWith(bases: BaseRepository, profile: { globalRole: string }) {
    return render(
      <I18nProvider>
        <AuthContext.Provider value={{ profile } as unknown as AuthContextValue}>
          <RepositoryProvider bases={bases}>
            <MemoryRouter initialEntries={['/']}>
              <Routes>
                <Route path="/" element={<CommandPalette />} />
                <Route path="/bases/:id" element={<div>BASE PAGE</div>} />
              </Routes>
            </MemoryRouter>
          </RepositoryProvider>
        </AuthContext.Provider>
      </I18nProvider>,
    );
  }

  test('rouvrir la palette relit la liste des bases', async () => {
    let bases = [listing('b1', 'Gliomes 2026', 'Neuro')];
    const repo = { async listMyBases() { return bases; } } as unknown as BaseRepository;
    renderWith(repo, { globalRole: 'medecin' });

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(await screen.findByText('Gliomes 2026')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    bases = [...bases, listing('b2', 'Base creee entre deux ouvertures', 'Neuro')];
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(await screen.findByText('Base creee entre deux ouvertures')).toBeInTheDocument();
  });

  test('un echec de chargement reste visible et reessayable, au lieu d une liste vide', async () => {
    let attempts = 0;
    const repo = {
      async listMyBases() {
        attempts += 1;
        if (attempts === 1) throw new Error('reseau');
        return [listing('b1', 'Gliomes 2026', 'Neuro')];
      },
    } as unknown as BaseRepository;
    renderWith(repo, { globalRole: 'medecin' });

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Les destinations ne peuvent pas être chargées.');
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Gliomes 2026')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('un compte de mission ne recoit pas une destination que la route lui refuserait', async () => {
    const repo = { async listMyBases() { return [listing('b1', 'Gliomes 2026', 'Neuro')]; } } as unknown as BaseRepository;
    renderWith(repo, { globalRole: 'saisisseur' });

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(await screen.findByText('Gliomes 2026')).toBeInTheDocument();
    expect(screen.queryByText('Mes jeux de variables')).not.toBeInTheDocument();
  });
});
