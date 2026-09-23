// @vitest-environment jsdom
// Page « Corbeille » (deplacee du tableau de bord vers la barre laterale) : liste des bases
// supprimees, restauration avec modale de confirmation, etats vide et hors-ligne.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { Trash } from './Trash';
import type { DeletedBase, BaseRepository } from '../../data/bases';
import type { FormPreparationRepository } from '../../data/formPreparations';
import { FormPreparationError } from '../../data/formPreparations';

function mockBases(deleted: DeletedBase[] = []): BaseRepository {
  return {
    async listDeletedBases() {
      return deleted;
    },
    async restoreDeletedBase() {},
    async purgeDeletedBase() {},
  } as unknown as BaseRepository;
}

function deletedBase(over: Partial<DeletedBase> = {}): DeletedBase {
  return {
    id: 'deleted-1', name: 'Registre clos', deletionReason: 'Création par erreur',
    deletedAt: '2026-08-01T10:00:00.000Z', purgeEligibleAt: '2026-08-01T10:00:00.000Z',
    patientCount: 0, encounterCount: 0, documentCount: 0, attachmentCount: 0, exportCount: 0,
    purgePending: false, purgeOperationId: null,
    ...over,
  };
}

function mockFormPreparations(overrides: Partial<FormPreparationRepository> = {}): FormPreparationRepository {
  return {
    available: true,
    async openOrResume() { throw new Error('not used'); },
    async read() { throw new Error('not used'); },
    async save() { throw new Error('not used'); },
    async preview() { throw new Error('not used'); },
    async apply() { throw new Error('not used'); },
    async resume() { throw new Error('not used'); },
    async discard() { throw new Error('not used'); },
    async issuePurgeChallenge(baseId, operationId) {
      return { challengeId: `challenge-${baseId}`, baseId, expiresAt: '2026-09-17T12:00:00.000Z', operationId, code: 'K7M3R' };
    },
    async preparePurgeChallenge() { throw new Error('not used'); },
    async confirmPurgeChallenge() { return { confirmed: true, baseId: 'deleted-1', challengeId: 'challenge-deleted-1', operationId: 'operation-1' }; },
    ...overrides,
  } as FormPreparationRepository;
}

function renderTrash(repo: BaseRepository, formPreparations = mockFormPreparations()) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={repo} formPreparations={formPreparations}>
        <Trash />
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('Trash (corbeille des bases)', () => {
  test('liste les bases supprimees avec leur motif et leurs dates', async () => {
    renderTrash(mockBases([{
      ...deletedBase(),
    }]));

    expect(await screen.findByText('Registre clos')).toBeInTheDocument();
    expect(screen.getByText('Création par erreur')).toBeInTheDocument();
    expect(screen.getByText(/Supprimée le/)).toBeInTheDocument();
    expect(screen.getByText(/Purge définitive disponible immédiatement/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Supprimer définitivement' })).toBeInTheDocument();
  });

  test('restaure une base apres confirmation, puis rafraichit la liste', async () => {
    const user = userEvent.setup();
    const restoreDeletedBase = vi.fn(async (_id: string) => undefined);
    let deleted: DeletedBase[] = [deletedBase()];
    const repo = {
      async listDeletedBases() {
        return deleted;
      },
      async restoreDeletedBase(id: string) {
        await restoreDeletedBase(id);
        deleted = [];
      },
    } as unknown as BaseRepository;

    renderTrash(repo);
    await screen.findByText('Registre clos');
    await user.click(screen.getByRole('button', { name: 'Restaurer' }));
    expect(screen.getByRole('dialog', { name: 'Restaurer cette base ?' })).toBeInTheDocument();
    expect(screen.getByText(/Les personnes précédemment invitées devront être invitées à nouveau/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restaurer la base' }));
    expect(restoreDeletedBase).toHaveBeenCalledWith('deleted-1');
    expect(await screen.findByText('Aucune base supprimée.')).toBeInTheDocument();
  });

  test('purge definitivement une base non vide apres confirmation forte', async () => {
    const user = userEvent.setup();
    const confirmPurgeChallenge = vi.fn(async (_baseId: string, _challengeId: string, _code: string, _operationId: string) => (
      { confirmed: true as const, baseId: 'deleted-1', challengeId: 'challenge-deleted-1', operationId: 'operation-1' }
    ));
    const purgeDeletedBase = vi.fn(async (_id: string, _operationId: string) => { deleted = []; });
    let deleted: DeletedBase[] = [deletedBase({ patientCount: 2, encounterCount: 3, documentCount: 1, attachmentCount: 1 })];
    const repo = {
      async listDeletedBases() { return deleted; },
      async restoreDeletedBase() {},
      purgeDeletedBase,
    } as unknown as BaseRepository;
    const formPreparations = mockFormPreparations({ issuePurgeChallenge: vi.fn(async (baseId, operationId) => ({
      challengeId: 'challenge-deleted-1', baseId, expiresAt: '2026-09-17T12:00:00.000Z', operationId, code: 'K7M3R',
    })), confirmPurgeChallenge });

    renderTrash(repo, formPreparations);
    await screen.findByText('Registre clos');
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));
    expect(screen.getByRole('dialog', { name: 'Supprimer définitivement cette base ?' })).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Supprimer définitivement cette base ?' });
    expect(within(dialog).getByText('Attention : cette base contient 2 patients.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Code à recopier')).toHaveTextContent('K7M3R');
    const input = within(dialog).getByLabelText('Saisissez le code affiché');
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer définitivement' });
    expect(confirm).toBeDisabled();
    await user.type(input, 'k7m3r');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(confirmPurgeChallenge).toHaveBeenCalledWith('deleted-1', 'challenge-deleted-1', 'K7M3R', expect.any(String));
    // La confirmation du code n'efface rien par elle-meme : sans cet appel, la base reste en corbeille.
    await waitFor(() => expect(purgeDeletedBase).toHaveBeenCalledWith('deleted-1', expect.any(String)));
    expect(await screen.findByText('Aucune base supprimée.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('La base « Registre clos » a été supprimée définitivement.');
  });

  test('conserve la saisie après un code erroné et accepte un code correct en minuscules', async () => {
    const user = userEvent.setup();
    let deleted: DeletedBase[] = [deletedBase()];
    const confirmPurgeChallenge = vi.fn()
      .mockRejectedValueOnce(new FormPreparationError('PURGE_CHALLENGE_MISMATCH'))
      .mockImplementationOnce(async () => (
        { confirmed: true as const, baseId: 'deleted-1', challengeId: 'challenge-deleted-1', operationId: 'operation-2' }
      ));
    const purgeDeletedBase = vi.fn(async (_id: string, _operationId: string) => { deleted = []; });
    const repo = {
      async listDeletedBases() { return deleted; },
      async restoreDeletedBase() {},
      purgeDeletedBase,
    } as unknown as BaseRepository;
    renderTrash(repo, mockFormPreparations({ confirmPurgeChallenge }));
    await screen.findByText('Registre clos');
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer définitivement cette base ?' });
    const input = within(dialog).getByLabelText('Saisissez le code affiché');
    await user.type(input, 'WRONG');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Le code ne correspond pas');
    expect(input).toHaveValue('WRONG');
    expect(confirmPurgeChallenge).toHaveBeenCalledTimes(1);
    expect(purgeDeletedBase).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, 'k7m3r');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(confirmPurgeChallenge).toHaveBeenCalledTimes(2);
    expect(confirmPurgeChallenge.mock.calls[0][3]).not.toBe(confirmPurgeChallenge.mock.calls[1][3]);
    expect(await screen.findByText('Aucune base supprimée.')).toBeInTheDocument();
  });

  test('garde le challenge pendant le dialogue et en génère un nouveau après Escape puis réouverture', async () => {
    const user = userEvent.setup();
    const codes = ['K7M3R', 'Q8T2V'];
    const issuePurgeChallenge = vi.fn(async (baseId: string, operationId: string) => ({
      challengeId: `challenge-${issuePurgeChallenge.mock.calls.length + 1}`,
      baseId,
      expiresAt: '2026-09-17T12:00:00.000Z',
      operationId,
      code: codes.shift()!,
    }));
    const repo = {
      async listDeletedBases() { return [deletedBase()]; },
      async restoreDeletedBase() {},
    } as unknown as BaseRepository;
    renderTrash(repo, mockFormPreparations({ issuePurgeChallenge }));
    await screen.findByText('Registre clos');
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));
    const firstDialog = await screen.findByRole('dialog', { name: 'Supprimer définitivement cette base ?' });
    expect(within(firstDialog).getByLabelText('Code à recopier')).toHaveTextContent('K7M3R');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Supprimer définitivement cette base ?' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));
    const secondDialog = await screen.findByRole('dialog', { name: 'Supprimer définitivement cette base ?' });
    expect(within(secondDialog).getByLabelText('Code à recopier')).toHaveTextContent('Q8T2V');
    expect(issuePurgeChallenge).toHaveBeenCalledTimes(2);
  });

  test('rejoue une purge interrompue sans redemander le code et avec la meme cle d operation', async () => {
    const user = userEvent.setup();
    const pendingOperationId = '123e4567-e89b-42d3-a456-426614174000';
    let deleted: DeletedBase[] = [deletedBase({ purgePending: true, purgeOperationId: pendingOperationId })];
    const confirmPurgeChallenge = vi.fn(async () => (
      { confirmed: true as const, baseId: 'deleted-1', challengeId: 'challenge-deleted-1', operationId: 'operation-1' }
    ));
    const purgeDeletedBase = vi.fn()
      .mockRejectedValueOnce(new Error('La purge definitive n a pas ete confirmee par le serveur.'))
      .mockImplementationOnce(async () => { deleted = []; });
    const repo = {
      async listDeletedBases() { return deleted; },
      async restoreDeletedBase() {},
      purgeDeletedBase,
    } as unknown as BaseRepository;
    renderTrash(repo, mockFormPreparations({ confirmPurgeChallenge }));
    await screen.findByText('Registre clos');
    await user.click(screen.getByRole('button', { name: 'Reprendre la suppression définitive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer définitivement cette base ?' });
    await user.type(within(dialog).getByLabelText('Saisissez le code affiché'), 'K7M3R');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('La purge definitive n a pas ete confirmee');

    await user.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    await waitFor(() => expect(purgeDeletedBase).toHaveBeenCalledTimes(2));
    // Le challenge n'est consomme qu'une fois et la cle d'operation reste celle de la purge en attente.
    expect(confirmPurgeChallenge).toHaveBeenCalledTimes(1);
    expect(purgeDeletedBase.mock.calls[0]).toEqual(['deleted-1', pendingOperationId]);
    expect(purgeDeletedBase.mock.calls[1]).toEqual(['deleted-1', pendingOperationId]);
    expect(await screen.findByText('Aucune base supprimée.')).toBeInTheDocument();
  });

  test('un double clic sur la confirmation ne declenche qu une seule purge', async () => {
    const user = userEvent.setup();
    let deleted: DeletedBase[] = [deletedBase()];
    const confirmPurgeChallenge = vi.fn(async () => (
      { confirmed: true as const, baseId: 'deleted-1', challengeId: 'challenge-deleted-1', operationId: 'operation-1' }
    ));
    const purgeDeletedBase = vi.fn(async (_id: string, _operationId: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      deleted = [];
    });
    const repo = {
      async listDeletedBases() { return deleted; },
      async restoreDeletedBase() {},
      purgeDeletedBase,
    } as unknown as BaseRepository;
    renderTrash(repo, mockFormPreparations({ confirmPurgeChallenge }));
    await screen.findByText('Registre clos');
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer définitivement cette base ?' });
    await user.type(within(dialog).getByLabelText('Saisissez le code affiché'), 'K7M3R');
    await user.dblClick(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(await screen.findByText('Aucune base supprimée.')).toBeInTheDocument();
    expect(confirmPurgeChallenge).toHaveBeenCalledTimes(1);
    expect(purgeDeletedBase).toHaveBeenCalledTimes(1);
  });

  test('bloque la restauration pendant une purge en attente et propose le rejeu', async () => {
    const base = deletedBase({ purgePending: true, purgeOperationId: '123e4567-e89b-42d3-a456-426614174000' });
    renderTrash(mockBases([base]));
    await screen.findByText('Registre clos');
    expect(screen.getByRole('button', { name: 'Restaurer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reprendre la suppression définitive' })).toBeInTheDocument();
  });

  test('affiche l etat vide quand aucune base n est supprimee', async () => {
    renderTrash(mockBases([]));
    expect(await screen.findByText('Aucune base supprimée.')).toBeInTheDocument();
  });
});
