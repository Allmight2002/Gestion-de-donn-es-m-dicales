// @vitest-environment jsdom
// "Mes gabarits" cote medecin : ne liste QUE ses gabarits personnels ; renommer / supprimer.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
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
      <ToastProvider>
        <RepositoryProvider templates={repo}>
          <MemoryRouter>
            <MyTemplates />
          </MemoryRouter>
        </RepositoryProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

async function openTemplateActions() {
  await userEvent.click(screen.getByRole('button', { name: /Actions.*Mon Neuro/ }));
}

describe('MyTemplates', () => {
  test('ne liste QUE les gabarits personnels du medecin (ni global, ni ceux d un autre)', async () => {
    renderMine(baseRepo());
    expect(await screen.findByText('Mon Neuro')).toBeInTheDocument();
    expect(screen.queryByText('Modele standard')).toBeNull();
    expect(screen.queryByText('Gabarit de Bob')).toBeNull();
  });

  test('ouvre la dernière version brouillon depuis l action principale de la carte', async () => {
    const getVersion = vi.fn(async (versionId: string) => ({
      version: { id: versionId, templateId: 'mine', versionNumber: versionId === 'v2' ? 2 : 1, status: versionId === 'v2' ? 'draft' as const : 'published' as const },
      fields: [],
      rules: [],
      sections: [],
    }));
    const repo = baseRepo({
      async listTemplates() {
        return [{
          id: 'mine', name: 'Mon Neuro', specialty: 'neuro', ownerUserId: 'me', isGlobal: false,
          versions: [
            { id: 'v1', templateId: 'mine', versionNumber: 1, status: 'published' as const },
            { id: 'v2', templateId: 'mine', versionNumber: 2, status: 'draft' as const },
          ],
        }];
      },
      getVersion,
    });
    const user = userEvent.setup();
    renderMine(repo);

    await user.click(await screen.findByRole('button', { name: /Ouvrir le jeu de variables/ }));

    await waitFor(() => expect(getVersion).toHaveBeenCalledWith('v2'));
    expect(await screen.findByRole('heading', { name: 'Mon Neuro' })).toBeInTheDocument();
    expect(screen.getByText('Version 2 · Brouillon')).toBeInTheDocument();
  });

  test('renommer appelle renameTemplate', async () => {
    const renameTemplate = vi.fn(async () => {});
    renderMine(baseRepo({ renameTemplate }));
    await screen.findByText('Mon Neuro');
    await openTemplateActions();
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
    await openTemplateActions();
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(screen.getByText('Confirmer la suppression ?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Oui' }));
    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith('mine'));
  });

  // D1 : le serveur refuse de supprimer un gabarit utilise par une base. Avant correction, le
  // clic sur "Oui" ne produisait AUCUN retour visible pres du bouton et la confirmation restait
  // ouverte -> l'utilisateur croyait que rien ne s'etait passe.
  test('un refus serveur est annonce au point de clic et referme la confirmation', async () => {
    const deleteTemplate = vi.fn(async () => {
      throw new Error('Gabarit utilise par une base');
    });
    renderMine(baseRepo({ deleteTemplate }));
    await screen.findByText('Mon Neuro');
    await openTemplateActions();
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Oui' }));

    expect(await screen.findByText('Gabarit utilise par une base')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Confirmer la suppression ?')).toBeNull());
    expect(screen.getByText('Mon Neuro')).toBeInTheDocument();
  });

  test('une suppression reussie annonce le succes et referme la confirmation', async () => {
    renderMine(baseRepo({ deleteTemplate: vi.fn(async () => {}) }));
    await screen.findByText('Mon Neuro');
    await openTemplateActions();
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Oui' }));

    expect(await screen.findByText('Jeu de variables supprimé')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Confirmer la suppression ?')).toBeNull());
  });
});
