// @vitest-environment jsdom
// Page « Corbeille » (deplacee du tableau de bord vers la barre laterale) : liste des bases
// supprimees, restauration avec modale de confirmation, etats vide et hors-ligne.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { Trash } from './Trash';
import type { DeletedBase, BaseRepository } from '../../data/bases';

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

function renderTrash(repo: BaseRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={repo}>
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
    const purgeDeletedBase = vi.fn(async (_id: string, _operationId: string) => {
      deleted = [];
    });
    let deleted: DeletedBase[] = [deletedBase({ patientCount: 2, encounterCount: 3, documentCount: 1, attachmentCount: 1 })];
    const repo = {
      async listDeletedBases() { return deleted; },
      async restoreDeletedBase() {},
      async purgeDeletedBase(id: string, operationId: string) { await purgeDeletedBase(id, operationId); },
    } as unknown as BaseRepository;

    renderTrash(repo);
    await screen.findByText('Registre clos');
    await user.click(screen.getByRole('button', { name: 'Supprimer définitivement' }));
    expect(screen.getByRole('dialog', { name: 'Supprimer définitivement cette base ?' })).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Supprimer définitivement cette base ?' });
    expect(within(dialog).queryByText(/contient 2 patient\(s\)/)).toBeNull();
    expect(within(dialog).getByLabelText('Saisissez exactement le nom de la base « Registre clos » :')).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer définitivement' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Saisissez exactement le nom de la base « Registre clos » :'), 'Registre clos');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(purgeDeletedBase).toHaveBeenCalledWith('deleted-1', expect.any(String));
    expect(await screen.findByText('Aucune base supprimée.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('La base « Registre clos » a été supprimée définitivement.');
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
