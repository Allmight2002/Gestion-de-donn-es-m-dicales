// @vitest-environment jsdom
// F3 v2 : la bibliotheque liste les gabarits GLOBAUX (base) et les clone dans un gabarit personnel ;
// repli sur les modeles livres en dur si aucun modele global n'est publie.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { AuthContext, type AuthContextValue } from '../../auth/AuthProvider';
import type { GlobalRole } from '../../auth/types';
import { TemplateLibrary } from './TemplateLibrary';
import { TEMPLATE_LIBRARY } from '../../domain/templateLibrary';
import type { TemplateBundleInput, TemplateRepository } from '../../data/templates';
import type { BaseRepository, PublishedTemplateOption } from '../../data/bases';

const authAs = (globalRole: GlobalRole): AuthContextValue => ({
  status: 'signed_in', user: { id: 'u1', email: null }, profile: { id: 'u1', fullName: 'Dr Test', globalRole, language: 'fr' },
  error: null, busy: false,
  async signIn() { return true; },
  async signOut() { /* sans objet */ },
  async sendPasswordReset() { return true; },
  async updatePassword() { return true; },
});

function renderLib(bases: BaseRepository, templates: TemplateRepository, globalRole: GlobalRole = 'medecin') {
  return render(
    <I18nProvider>
      <AuthContext.Provider value={authAs(globalRole)}>
        <RepositoryProvider bases={bases} templates={templates}>
          <MemoryRouter initialEntries={['/templates/library']}>
            <Routes>
              <Route path="/templates/library" element={<TemplateLibrary />} />
              <Route path="/templates" element={<div>TEMPLATES</div>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </AuthContext.Provider>
    </I18nProvider>,
  );
}

describe('TemplateLibrary (F3 v2)', () => {
  test('liste les gabarits GLOBAUX (base) et « Utiliser » clone leurs champs dans un gabarit personnel', async () => {
    const models: PublishedTemplateOption[] = [
      { versionId: 'gv1', versionNumber: 1, templateId: 't1', name: 'Neuro global', specialty: 'Neurologie', scope: 'global' },
      { versionId: 'pv1', versionNumber: 1, templateId: 't2', name: 'Mon perso', specialty: null, scope: 'personal' }, // ignore (non global)
    ];
    const bases = { async listTemplateModels() { return models; } } as unknown as BaseRepository;
    const createTemplateBundle = vi.fn(async (_input: TemplateBundleInput) => ({ templateId: 'new', versionId: 'vnew', baseId: null }));
    const getVersion = vi.fn(async () => ({
      version: { id: 'vnew', templateId: 'new', versionNumber: 1, status: 'draft' as const },
      fields: [], rules: [], sections: [],
    }));
    const templates = { createTemplateBundle, getVersion } as unknown as TemplateRepository;

    renderLib(bases, templates);
    expect(await screen.findByText('Neuro global')).toBeInTheDocument();
    expect(screen.queryByText('Mon perso')).not.toBeInTheDocument(); // personnel exclu

    await userEvent.click(screen.getByRole('button', { name: 'Utiliser ce modèle' }));
    await waitFor(() => expect(createTemplateBundle).toHaveBeenCalledTimes(1));
    expect(createTemplateBundle).toHaveBeenCalledWith(expect.objectContaining({ name: 'Neuro global', specialty: 'Neurologie', sourceVersionId: 'gv1' }));
    expect(await screen.findByRole('heading', { name: 'Neuro global' })).toBeInTheDocument();
  });

  test('repli : aucun modele global -> affiche les modeles livres en dur', async () => {
    const bases = { async listTemplateModels() { return []; } } as unknown as BaseRepository;
    const createTemplateBundle = vi.fn(async (_input: TemplateBundleInput) => ({ templateId: 'new', versionId: 'vnew', baseId: null }));
    const templates = { createTemplateBundle } as unknown as TemplateRepository;

    renderLib(bases, templates);
    const first = TEMPLATE_LIBRARY[0];
    expect(await screen.findByText(first.name)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Utiliser ce modèle' })[0]);
    await waitFor(() => expect(createTemplateBundle).toHaveBeenCalledTimes(1));
    expect(createTemplateBundle.mock.calls[0][0].fields).toHaveLength(first.fields.length);
  });

  // Audit UI mobile, lot 5 (5.12) : un bouton secondaire par carte, et la note sur les modeles
  // globaux reservee a qui peut en publier.
  test('les modeles s utilisent par un bouton secondaire ; la note d administration est reservee aux administrateurs', async () => {
    const bases = { async listTemplateModels() { return []; } } as unknown as BaseRepository;
    const templates = {} as unknown as TemplateRepository;
    const { unmount } = renderLib(bases, templates);
    const buttons = await screen.findAllByRole('button', { name: 'Utiliser ce modèle' });
    expect(buttons.length).toBe(TEMPLATE_LIBRARY.length);
    for (const button of buttons) expect(button).toHaveClass('btn-secondary');
    expect(screen.queryByText(/un admin peut en créer/)).toBeNull();
    unmount();

    renderLib(bases, templates, 'system_admin');
    expect(await screen.findByText(/un admin peut en créer/)).toBeInTheDocument();
  });
});
