// @vitest-environment jsdom
// Tests de rendu du tableau de bord (cahier §8.3) avec repository INJECTE.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
    async getInclusionStats() {
      return { total: 0, target: null, targetDate: null, monthly: [] };
    },
    async setInclusionTarget() {},
    async listTemplateModels() {
      return [{ versionId: 'v1', versionNumber: 1, templateId: 't1', name: 'Neurochirurgie', specialty: 'neuro', scope: 'global' as const }];
    },
    async createBase(name, specialty, versionId) {
      const id = `bnew${++n}`;
      bases.push({
        base: { id, name, specialty, ownerUserId: 'u', currentTemplateVersionId: versionId },
        role: 'owner',
        permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
        templateName: 'Neurochirurgie',
        versionNumber: 1,
      });
      return { id, name, specialty, ownerUserId: 'u', currentTemplateVersionId: versionId };
    },
    async getBase(id) {
      return bases.find((b) => b.base.id === id) ?? null;
    },
    async setTemplateVersion() {},
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
  test('liste les bases avec leur role', async () => {
    renderApp(mockBases());
    expect(await screen.findByText('Registre Neuro')).toBeInTheDocument();
    expect(screen.getByText('Propriétaire')).toBeInTheDocument();
  });

  test('creer une base ouvre la page de la base (medecin)', async () => {
    const user = userEvent.setup();
    renderApp(mockBases());
    await screen.findByText('Registre Neuro');
    await user.type(screen.getByLabelText('Nom de la base'), 'Registre AVC');
    await user.click(screen.getByRole('button', { name: 'Créer la base' }));
    // Navigation vers /bases/:id -> BaseHome affiche la nouvelle base.
    expect(await screen.findByText('Registre AVC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nouveau patient/i })).toBeInTheDocument();
  });

  test('un compte staff (curateur) ne voit PAS le formulaire de creation de base', async () => {
    auth.role = 'curateur';
    renderApp(mockBases());
    await screen.findByText('Registre Neuro');
    expect(screen.queryByRole('button', { name: 'Créer la base' })).toBeNull();
    expect(screen.queryByLabelText('Nom de la base')).toBeNull();
  });
});

describe('BaseHome', () => {
  test('affiche les infos de la base', async () => {
    renderApp(mockBases(), '/bases/b1');
    expect(await screen.findByText('Registre Neuro')).toBeInTheDocument();
    expect(screen.getByText(/Neurochirurgie v1/)).toBeInTheDocument();
  });
});
