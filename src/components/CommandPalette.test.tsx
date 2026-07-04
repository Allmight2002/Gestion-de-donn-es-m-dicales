// @vitest-environment jsdom
// A5 : la palette de recherche (Ctrl+K) liste les bases, filtre et navigue.
import { describe, expect, test } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
});
