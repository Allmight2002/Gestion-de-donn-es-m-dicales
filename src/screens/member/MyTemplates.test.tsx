// @vitest-environment jsdom
// "Mes gabarits" cote medecin : ne liste QUE ses gabarits personnels ; renommer / supprimer.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { MyTemplates } from './MyTemplates';
import type { TemplateRepository } from '../../data/templates';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', email: null }, profile: { id: 'me', fullName: 'Doc', globalRole: 'medecin', language: 'fr' }, signOut: () => {} }),
}));

function baseRepo(over: Partial<TemplateRepository> = {}): TemplateRepository {
  return {
    async listTemplates() {
      return [
        { id: 'mine', name: 'Mon Neuro', specialty: 'neuro', ownerUserId: 'me', isGlobal: false, versions: [{ id: 'v1', templateId: 'mine', versionNumber: 1, status: 'draft' as const }] },
        { id: 'glob', name: 'Modele standard', specialty: null, ownerUserId: null, isGlobal: true, versions: [{ id: 'vg', templateId: 'glob', versionNumber: 1, status: 'published' as const }] },
        { id: 'other', name: 'Gabarit de Bob', specialty: null, ownerUserId: 'bob', isGlobal: false, versions: [] },
      ];
    },
    async renameTemplate() {},
    async deleteTemplate() {},
    ...over,
  } as unknown as TemplateRepository;
}

function renderMine(repo: TemplateRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider templates={repo}>
        <MemoryRouter>
          <MyTemplates />
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('MyTemplates', () => {
  test('ne liste QUE les gabarits personnels du medecin (ni global, ni ceux d un autre)', async () => {
    renderMine(baseRepo());
    expect(await screen.findByText('Mon Neuro')).toBeInTheDocument();
    expect(screen.queryByText('Modele standard')).toBeNull();
    expect(screen.queryByText('Gabarit de Bob')).toBeNull();
  });

  test('renommer appelle renameTemplate', async () => {
    const renameTemplate = vi.fn(async () => {});
    renderMine(baseRepo({ renameTemplate }));
    await screen.findByText('Mon Neuro');
    await userEvent.click(screen.getByRole('button', { name: 'Renommer' }));
    const input = screen.getByDisplayValue('Mon Neuro');
    await userEvent.clear(input);
    await userEvent.type(input, 'Neuro perso');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(renameTemplate).toHaveBeenCalledWith('mine', 'Neuro perso', 'neuro'));
  });

  test('supprimer demande confirmation puis appelle deleteTemplate', async () => {
    const deleteTemplate = vi.fn(async () => {});
    renderMine(baseRepo({ deleteTemplate }));
    await screen.findByText('Mon Neuro');
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(screen.getByText('Confirmer la suppression ?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Oui' }));
    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith('mine'));
  });
});
