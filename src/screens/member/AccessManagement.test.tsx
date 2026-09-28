// @vitest-environment jsdom
// Tests de rendu de la gestion des acces (cahier §8.10) avec repos INJECTES.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  test('affiche une structure de chargement utile avant les permissions', () => {
    const pendingRepo = {
      ...baseRepoWithRole('owner'),
      async getBase() { return new Promise<BaseListing | null>(() => {}); },
    } as unknown as BaseRepository;
    const { container, unmount } = renderAccess(pendingRepo, makeAccess());

    expect(screen.getByRole('status', { name: /Chargement/ })).toBeInTheDocument();
    // Les cinq lignes du squelette ; l'icone ⓘ de l'en-tete (audit UI mobile, lot 1) est
    // decorative elle aussi, mais ne fait pas partie de la structure de chargement.
    expect(container.querySelectorAll('div[aria-hidden="true"]')).toHaveLength(5);
    unmount();
  });

  test('le proprietaire invite (lien genere) et voit les acces actuels', async () => {
    const createInvitation = vi.fn(async (_b: string, _e: string, _r: AccessRole, _p: BasePermissions) => ({ token: 'tok-123' }));
    renderAccess(baseRepoWithRole('owner'), makeAccess({ createInvitation }));

    expect(await screen.findByText(/Anna Analyste/)).toBeInTheDocument(); // acces actuel

    await userEvent.click(screen.getByRole('button', { name: 'Inviter' }));
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

    await userEvent.click(screen.getByRole('button', { name: 'Inviter' }));
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'pi@demo.test' } });
    // Choisir « Investigateur principal » coche toutes les permissions (dont la gestion des accès).
    fireEvent.change(screen.getByLabelText('Profil'), { target: { value: 'principal_investigator' } });
    // Les droits des membres restent replies : la seule case est celle de l'invitation.
    expect(screen.getByLabelText('Gestion des accès')).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: "Créer l'invitation" }));
    await waitFor(() => expect(createInvitation).toHaveBeenCalledTimes(1));
    const [, , role, perms] = createInvitation.mock.calls[0];
    expect(role).toBe('editor'); // déduit des permissions (il y a de la saisie)
    expect(perms).toMatchObject({ canManageAccess: true, canViewIdentity: true, canExportData: true, canEditStructuredData: true });
  });

  test('desactive les permissions existantes pendant leur enregistrement', async () => {
    let finishSave: (() => void) | undefined;
    const setPermissions = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    renderAccess(baseRepoWithRole('owner'), makeAccess({ setPermissions }));
    await screen.findByText(/Anna Analyste/);

    await userEvent.click(screen.getByRole('button', { name: 'Modifier les droits' }));
    const currentExport = screen.getByRole('checkbox', { name: 'Export' });
    await userEvent.click(currentExport);
    await waitFor(() => expect(currentExport).toBeDisabled());
    expect(setPermissions).toHaveBeenCalledTimes(1);

    finishSave?.();
    await waitFor(() => expect(currentExport).not.toBeDisabled());
  });

  test('E1 affiche l activite de consultation d identite (qui a lu quel patient)', async () => {
    const getIdentityAudit = vi.fn(async () => ({
      byReader: [{ readerName: 'Dr Ngo', count: 3, lastAt: '2026-07-01T10:00:00.000Z' }],
      reads: [{ at: '2026-07-01T10:00:00.000Z', readerName: 'Dr Ngo', patientCode: 'P-0042' }],
    }));
    renderAccess(baseRepoWithRole('owner'), makeAccess({ getIdentityAudit }));
    // Audit UI mobile, lot 5 : repliees dans « Surveillance », ouvertes a la demande.
    const monitoring = await screen.findByRole('button', { name: 'Surveillance' });
    expect(monitoring).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(monitoring);
    expect(screen.getByText(/Consultations d.identité/)).toBeVisible();
    expect(screen.getByText(/3 consultations/)).toBeVisible(); // synthèse visible d'abord
    await userEvent.click(screen.getByText(/Voir le détail/));
    expect(screen.getByText('P-0042')).toBeInTheDocument(); // patient pseudonymisé consulté
  });

  test('limite le journal detaille a 20 lignes puis affiche la suite sur demande', async () => {
    const reads = Array.from({ length: 25 }, (_, index) => ({
      at: `2026-07-01T10:${String(index).padStart(2, '0')}:00.000Z`,
      readerName: 'Dr Ngo',
      patientCode: `P-${String(index + 1).padStart(4, '0')}`,
    }));
    renderAccess(baseRepoWithRole('owner'), makeAccess({
      async getIdentityAudit() {
        return { byReader: [{ readerName: 'Dr Ngo', count: 25, lastAt: reads[24].at }], reads };
      },
    }));

    await userEvent.click(await screen.findByRole('button', { name: 'Surveillance' }));
    await userEvent.click(screen.getByText(/Voir le détail/));
    expect(screen.getByText('P-0020')).toBeInTheDocument();
    expect(screen.queryByText('P-0021')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Afficher la suite' }));
    expect(screen.getByText('P-0025')).toBeInTheDocument();
  });

  // Audit UI mobile, lot 5 (5.9 Accès A) : les membres d'abord, en cartes compactes.
  test('les membres passent avant l invitation, qui s ouvre a la demande avec les droits avant le bouton', async () => {
    renderAccess(baseRepoWithRole('owner'), makeAccess());
    const member = (await screen.findByText('Anna Analyste')).closest('li') as HTMLLIElement;
    expect(within(member).getByRole('list', { name: 'Droits de Anna Analyste' })).toHaveTextContent('Export');
    expect(within(member).queryByRole('checkbox')).toBeNull();
    expect(screen.queryByLabelText('E-mail')).toBeNull();
    // Aucune invitation en attente : pas de section vide.
    expect(screen.queryByText('Invitations en attente')).toBeNull();

    const invite = screen.getByRole('button', { name: 'Inviter' });
    expect(invite).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(invite);
    const submit = screen.getByRole('button', { name: "Créer l'invitation" });
    const rights = screen.getByRole('group', { name: 'Ajuster les permissions' });
    expect(rights.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Le bouton de l'en-tete devient « Annuler » : un seul bouton plein a la fois.
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveClass('btn-secondary');
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByLabelText('E-mail')).toBeNull();
  });

  test('une invitation en attente se liste et se revoque', async () => {
    const revokeInvitation = vi.fn(async () => {});
    renderAccess(baseRepoWithRole('owner'), makeAccess({
      revokeInvitation,
      async listInvitations() {
        return [{ id: 'i1', email: 'collegue@demo.test', role: 'viewer', permissions: { ...NO_PERMISSIONS }, status: 'pending', expiresAt: '2099-01-01T00:00:00Z' }];
      },
    }));
    const pending = (await screen.findByText('collegue@demo.test', { exact: false })).closest('li') as HTMLLIElement;
    await userEvent.click(within(pending).getByRole('button', { name: 'Révoquer' }));
    expect(revokeInvitation).toHaveBeenCalledWith('i1');
  });

  test('un non-proprietaire ne voit pas la gestion des acces', async () => {
    renderAccess(baseRepoWithRole('editor'), makeAccess());
    expect(await screen.findByText(/propri/i)).toBeInTheDocument();
  });
});
