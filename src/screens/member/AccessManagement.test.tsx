// @vitest-environment jsdom
// Tests de rendu de la gestion des acces (cahier §8.10) avec repos INJECTES.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { AccessManagement } from './AccessManagement';
import type { BaseRepository, BaseListing, BaseRole } from '../../data/bases';
import { NO_PERMISSIONS, type AccessRepository, type AccessRole, type BasePermissions } from '../../data/access';

function baseRepoWithRole(role: BaseRole): BaseRepository {
  const listing: BaseListing = {
    base: { id: 'b1', name: 'Base', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
    role,
    // Seul le proprietaire peut gerer ici : aucune permission can_manage_access deleguee.
    permissions: { ...NO_PERMISSIONS },
    templateName: 'Neuro', versionNumber: 1,
  };
  return { async getBase() { return listing; } } as unknown as BaseRepository;
}

function makeAccess(over: Partial<AccessRepository> = {}): AccessRepository {
  return {
    async listInvitations() { return []; },
    async createInvitation() { return { token: 'tok-123' }; },
    async revokeInvitation() {},
    async listAccess() {
      return [{ id: 'a1', userId: 'u2', fullName: 'Anna Analyste', role: 'viewer', permissions: { ...NO_PERMISSIONS, canExportData: true } }];
    },
    async revokeAccess() {},
    async setPermissions() {},
    async acceptInvitation() {},
    async getIdentityAudit() { return { byReader: [], reads: [] }; },
    ...over,
  } as unknown as AccessRepository;
}

function renderAccess(baseRepo: BaseRepository, access: AccessRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={baseRepo} access={access}>
        <MemoryRouter initialEntries={['/bases/b1/access']}>
          <Routes>
            <Route path="/bases/:id/access" element={<AccessManagement />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('AccessManagement', () => {
  test('le proprietaire invite (lien genere) et voit les acces actuels', async () => {
    const createInvitation = vi.fn(async (_b: string, _e: string, _r: AccessRole, _p: BasePermissions) => ({ token: 'tok-123' }));
    renderAccess(baseRepoWithRole('owner'), makeAccess({ createInvitation }));

    expect(await screen.findByText(/Anna Analyste/)).toBeInTheDocument(); // acces actuel

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'collab@demo.test' } });
    await userEvent.click(screen.getByRole('button', { name: "Créer l'invitation" }));

    await waitFor(() => expect(createInvitation).toHaveBeenCalledTimes(1));
    expect(createInvitation.mock.calls[0][1]).toBe('collab@demo.test');
    expect(await screen.findByText(/tok-123/)).toBeInTheDocument(); // lien a partager
  });

  test('C1 choisir un profil nomme coche les permissions et deduit le role a l invitation', async () => {
    const createInvitation = vi.fn(async (_b: string, _e: string, _r: AccessRole, _p: BasePermissions) => ({ token: 'tok-123' }));
    renderAccess(baseRepoWithRole('owner'), makeAccess({ createInvitation }));
    await screen.findByText(/Anna Analyste/);

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pi@demo.test' } });
    // Choisir « Investigateur principal » coche toutes les permissions (dont la gestion des accès).
    fireEvent.change(screen.getByLabelText('Profil'), { target: { value: 'principal_investigator' } });
    // La case du FORMULAIRE d'invitation (la 1re ; la liste des accès en a aussi une) est cochée.
    expect(screen.getAllByLabelText('Gestion des accès')[0]).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: "Créer l'invitation" }));
    await waitFor(() => expect(createInvitation).toHaveBeenCalledTimes(1));
    const [, , role, perms] = createInvitation.mock.calls[0];
    expect(role).toBe('editor'); // déduit des permissions (il y a de la saisie)
    expect(perms).toMatchObject({ canManageAccess: true, canViewIdentity: true, canExportData: true, canEditStructuredData: true });
  });

  test('E1 affiche l activite de consultation d identite (qui a lu quel patient)', async () => {
    const getIdentityAudit = vi.fn(async () => ({
      byReader: [{ readerName: 'Dr Ngo', count: 3, lastAt: '2026-07-01T10:00:00.000Z' }],
      reads: [{ at: '2026-07-01T10:00:00.000Z', readerName: 'Dr Ngo', patientCode: 'P-0042' }],
    }));
    renderAccess(baseRepoWithRole('owner'), makeAccess({ getIdentityAudit }));
    expect(await screen.findByText(/Consultations d.identité/)).toBeInTheDocument();
    expect(screen.getByText('P-0042')).toBeInTheDocument(); // patient pseudonymisé consulté
    expect(screen.getByText(/3 consultations/)).toBeInTheDocument(); // compteur par lecteur (signal)
  });

  test('un non-proprietaire ne voit pas la gestion des acces', async () => {
    renderAccess(baseRepoWithRole('editor'), makeAccess());
    expect(await screen.findByText(/propri/i)).toBeInTheDocument();
  });
});
