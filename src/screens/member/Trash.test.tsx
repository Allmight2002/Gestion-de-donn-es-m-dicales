// @vitest-environment jsdom
// Page « Corbeille » (deplacee du tableau de bord vers la barre laterale) : liste des bases
// supprimees, restauration avec modale de confirmation, etats vide et hors-ligne.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  } as unknown as BaseRepository;
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
      id: 'deleted-1', name: 'Registre clos', deletionReason: 'Création par erreur',
      deletedAt: '2026-08-01T10:00:00.000Z', purgeEligibleAt: '2027-08-01T10:00:00.000Z',
    }]));

    expect(await screen.findByText('Registre clos')).toBeInTheDocument();
    expect(screen.getByText('Création par erreur')).toBeInTheDocument();
    expect(screen.getByText(/Supprimée le/)).toBeInTheDocument();
    expect(screen.getByText(/Purge manuelle possible à partir du/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurer' })).toBeInTheDocument();
  });

  test('restaure une base apres confirmation, puis rafraichit la liste', async () => {
    const user = userEvent.setup();
    const restoreDeletedBase = vi.fn(async (_id: string) => undefined);
    let deleted: DeletedBase[] = [{
      id: 'deleted-1', name: 'Registre clos', deletionReason: 'Création par erreur',
      deletedAt: '2026-08-01T10:00:00.000Z', purgeEligibleAt: '2027-08-01T10:00:00.000Z',
    }];
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

  test('affiche l etat vide quand aucune base n est supprimee', async () => {
    renderTrash(mockBases([]));
    expect(await screen.findByText('Aucune base supprimée.')).toBeInTheDocument();
  });
});