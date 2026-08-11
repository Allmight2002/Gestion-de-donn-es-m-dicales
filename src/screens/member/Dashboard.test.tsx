// @vitest-environment jsdom
// Tests de rendu du tableau de bord (cahier §8.3) avec repository INJECTE.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { Dashboard } from './Dashboard';
import { BaseHome } from './BaseHome';
import type { BaseListing, BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository } from '../../data/patients';
import type { GlobalRole } from '../../auth/types';

// useAuth mocke : le role pilote le gating "creation de base" (medecin uniquement).
const auth = vi.hoisted(() => ({ role: 'medecin' as GlobalRole }));
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u', fullName: 'M', globalRole: auth.role, language: 'fr' }, user: { id: 'u', email: null }, signOut: () => {} }),
}));
beforeEach(() => { auth.role = 'medecin'; });

// BaseHome a besoin des gabarits (libelles colonnes) et des patients : stubs simples.
const stubTemplates = {
  async getVersion() {
    return { version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const }, fields: [], rules: [] };
  },
} as unknown as TemplateRepository;
const stubPatients = {
  async listPatients() { return []; },
  async listPatientsPage() { return { rows: [], total: 0 }; },
} as unknown as PatientRepository;

function mockBases(): BaseRepository {
  let n = 0;
  const bases: BaseListing[] = [
    {
      base: { id: 'b1', name: 'Registre Neuro', specialty: 'neuro', ownerUserId: 'u', currentTemplateVersionId: 'v1' },
      role: 'owner',
      permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
      templateName: 'Neurochirurgie',
      versionNumber: 1,
    },
  ];
  return {
    async listMyBases() {
      return [...bases];
    },
    async listDeletedBases() {
      return [];
    },
    async getInclusionStats() {
      return { total: 0, target: null, targetDate: null, targetRevision: 0, monthly: [] };
    },
    async getCompletenessStats() {
      return [];
    },
    async setInclusionTarget() {},
    async listTemplateModels() {
      return [{ versionId: 'v1', versionNumber: 1, templateId: 't1', name: 'Neurochirurgie', specialty: 'neuro', scope: 'global' as const }];
    },
    async createBase(name, specialty, versionId, observationModel = 'longitudinal') {
      const id = `bnew${++n}`;
      bases.push({
        base: { id, name, specialty, ownerUserId: 'u', currentTemplateVersionId: versionId, observationModel },
        role: 'owner',
        permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
        templateName: 'Neurochirurgie',
        versionNumber: 1,
      });
      return { id, name, specialty, ownerUserId: 'u', currentTemplateVersionId: versionId, observationModel };
    },
    async getBase(id) {
      return bases.find((b) => b.base.id === id) ?? null;
    },
    async softDeleteBase() {},
    async restoreDeletedBase() {},
    async setTemplateVersion() {},
    async setObservationModel() {
      return { id: 'b1', name: 'Registre Neuro', specialty: 'neuro', ownerUserId: 'u', currentTemplateVersionId: 'v1', observationModel: 'longitudinal' as const };
    },
  };
}

function renderApp(repo: BaseRepository, initialEntry = '/') {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={repo} templates={stubTemplates} patients={stubPatients}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/bases/:id" element={<BaseHome />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('Dashboard', () => {
  test('affiche un chargement structure et compatible avec la reduction des mouvements', async () => {
    const source = mockBases();
    const listings = await source.listMyBases();
    let finishLoad: ((value: BaseListing[]) => void) | undefined;
    const repo = {
      ...source,
      async listMyBases() { return new Promise<BaseListing[]>((resolve) => { finishLoad = resolve; }); },
    } as BaseRepository;

    const { container } = renderApp(repo);
    const status = screen.getByRole('status', { name: /Chargement/ });
    expect(status).toBeInTheDocument();
    expect(container.querySelectorAll('.motion-reduce\\:animate-none')).toHaveLength(3);

    await act(async () => { finishLoad?.(listings); });
    expect(await screen.findByText('Registre Neuro')).toBeInTheDocument();
  });

  test('liste les bases avec leur role', async () => {
    renderApp(mockBases());
    expect(await screen.findByText('Registre Neuro')).toBeInTheDocument();
    expect(screen.getByText('Propriétaire')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Registre Neuro/ })).toHaveClass('h-full', 'motion-reduce:transition-none');
    // La creation est progressive : le formulaire ne concurrence pas la liste au chargement.
    await userEvent.click(screen.getByRole('button', { name: 'Nouvelle base' }));
    expect(screen.getByRole('link', { name: /depuis un fichier Excel/ })).toBeInTheDocument();
  });

  test('creer une base ouvre la page de la base (medecin)', async () => {
    const user = userEvent.setup();
    renderApp(mockBases());
    await screen.findByText('Registre Neuro');
    await user.click(screen.getByRole('button', { name: 'Nouvelle base' }));
    await user.type(screen.getByLabelText('Nom de la base'), 'Registre AVC');
    await user.click(screen.getByRole('button', { name: 'Créer la base' }));
    // Navigation vers /bases/:id -> BaseHome affiche la nouvelle base.
    expect((await screen.findAllByRole('button', { name: /nouveau patient/i })).length).toBeGreaterThan(0);
    expect(screen.getByText('Registre AVC')).toBeInTheDocument();
  });

  test('choisit le modele transversal a la creation', async () => {
    const user = userEvent.setup();
    const repo = mockBases();
    const createBase = vi.spyOn(repo, 'createBase');
    renderApp(repo);
    await screen.findByText('Registre Neuro');
    await user.click(screen.getByRole('button', { name: 'Nouvelle base' }));
    await user.type(screen.getByLabelText('Nom de la base'), 'Enquete prevalence');
    await user.selectOptions(screen.getByLabelText(/Modèle d’observation/), 'cross_sectional');
    await user.click(screen.getByRole('button', { name: 'Créer la base' }));
    expect(createBase).toHaveBeenCalledWith('Enquete prevalence', null, 'v1', 'cross_sectional');
  });

  test('un compte staff (curateur) ne voit PAS le formulaire de creation de base', async () => {
    auth.role = 'curateur';
    renderApp(mockBases());
    await screen.findByText('Registre Neuro');
    expect(screen.queryByRole('button', { name: 'Créer la base' })).toBeNull();
    expect(screen.queryByLabelText('Nom de la base')).toBeNull();
    expect(screen.queryByRole('link', { name: /depuis un fichier Excel/ })).toBeNull();
  });

  // Compte de mission (docs/spec-comptes-mission.md §8) : ni creation de base, et a
  // l'echeance un ecran qui EXPLIQUE au lieu d'un tableau vide ou d'une erreur brute.
  test('un compte de mission ne voit pas la creation de base', async () => {
    auth.role = 'saisisseur';
    renderApp(mockBases());
    await screen.findByText('Registre Neuro');
    expect(screen.queryByRole('button', { name: 'Créer la base' })).toBeNull();
    expect(screen.queryByLabelText('Nom de la base')).toBeNull();
  });

  test('mission terminee : un ecran explicite remplace la liste vide', async () => {
    auth.role = 'saisisseur';
    const empty = { ...mockBases(), async listMyBases() { return []; } } as unknown as BaseRepository;
    renderApp(empty);
    expect(await screen.findByText('Mission terminée')).toBeInTheDocument();
    expect(screen.getByText(/Les données que vous avez saisies restent enregistrées/)).toBeInTheDocument();
  });

  test('un medecin sans base garde l invitation a en creer une', async () => {
    const empty = { ...mockBases(), async listMyBases() { return []; } } as unknown as BaseRepository;
    renderApp(empty);
    await screen.findByRole('button', { name: /Nouvelle base/ });
    expect(screen.queryByText('Mission terminée')).toBeNull();
  });

  test('restaure une base depuis la corbeille sans remettre les acces partages', async () => {
    const user = userEvent.setup();
    const restoreDeletedBase = vi.fn(async () => undefined);
    const repo = {
      ...mockBases(),
      async listDeletedBases() {
        return [{
          id: 'deleted-1', name: 'Registre clos', deletionReason: 'Création par erreur',
          deletedAt: '2026-08-01T10:00:00.000Z', purgeEligibleAt: '2027-08-01T10:00:00.000Z',
        }];
      },
      restoreDeletedBase,
    } as BaseRepository;

    renderApp(repo);
    const trashTitle = await screen.findByText(/Corbeille/);
    expect(screen.getByText('Retrouvez ici vos bases supprimées.')).toBeInTheDocument();
    expect(trashTitle.closest('details')).not.toHaveAttribute('open');
    await user.click(trashTitle);
    expect(trashTitle.closest('details')).toHaveAttribute('open');
    expect(await screen.findByText('Registre clos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restaurer' }));
    expect(screen.getByRole('dialog', { name: 'Restaurer cette base ?' })).toBeInTheDocument();
    expect(screen.getByText(/Les personnes précédemment invitées devront être invitées à nouveau/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restaurer la base' }));
    expect(restoreDeletedBase).toHaveBeenCalledWith('deleted-1');
  });
});

describe('BaseHome', () => {
  test('affiche les infos de la base', async () => {
    renderApp(mockBases(), '/bases/b1');
    expect(await screen.findByText('Registre Neuro')).toBeInTheDocument();
    expect(screen.getByText('Neurochirurgie · v1')).toBeInTheDocument();
  });
});
