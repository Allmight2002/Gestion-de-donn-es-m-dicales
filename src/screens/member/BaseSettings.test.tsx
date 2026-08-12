// @vitest-environment jsdom
// Reglages d'une base : ce qui vivait dans le menu « … » de la liste des patients (copie
// hors-ligne, modele d'observation, suppression) a un ecran a lui, sous l'onglet Parametres.
import 'fake-indexeddb/auto';
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseSettings } from './BaseSettings';
import { offlineCache } from '../../data/offline';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { PatientRepository } from '../../data/patients';

const ALL_PERMS = {
  canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true,
  canExportData: true, canManageAccess: true,
};

const ownerListing: BaseListing = {
  base: { id: 'b1', name: 'Registre Neuro', specialty: 'neuro', ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner',
  permissions: ALL_PERMS,
  templateName: 'Neurochirurgie',
  versionNumber: 1,
};

const emptyPage = { async listPatientsPage() { return { rows: [], total: 0 }; } } as unknown as PatientRepository;

function renderSettings(bases: BaseRepository, patients: PatientRepository = emptyPage) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases} patients={patients}>
        <MemoryRouter initialEntries={['/bases/b1/parametres']}>
          <Routes>
            <Route path="/bases/:id/parametres" element={<BaseSettings />} />
            <Route path="/" element={<div>TABLEAU DE BORD</div>} />
            <Route path="/missions" element={<div>COMPTES DE MISSION</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('BaseSettings', () => {
  test('exige un motif et le nom de la base avant la suppression proprietaire', async () => {
    const user = userEvent.setup();
    const softDeleteBase = vi.fn(async () => undefined);
    const removeOffline = vi.spyOn(offlineCache, 'remove').mockResolvedValue();
    const bases = { async getBase() { return ownerListing; }, softDeleteBase } as unknown as BaseRepository;

    renderSettings(bases);

    await user.click(await screen.findByRole('button', { name: 'Supprimer la base' }));
    const dialog = screen.getByRole('dialog', { name: 'Supprimer cette base ?' });
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer la base' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Motif de la suppression'), 'Création par erreur');
    await user.type(within(dialog).getByLabelText('Saisissez le nom de la base pour confirmer'), 'Registre Neuro');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(softDeleteBase).toHaveBeenCalledWith('b1', 'Création par erreur');
    expect(await screen.findByText('TABLEAU DE BORD')).toBeInTheDocument();
    removeOffline.mockRestore();
  });

  test('propose la copie hors-ligne et renvoie aux comptes de mission', async () => {
    const bases = { async getBase() { return ownerListing; } } as unknown as BaseRepository;
    renderSettings(bases);
    expect(await screen.findByRole('button', { name: 'Rendre disponible hors-ligne' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Comptes de mission/ })).toBeInTheDocument();
  });

  test('un acces a echeance ne se voit ni proposer de copie locale ni les actions du proprietaire', async () => {
    const expiring: BaseListing = {
      ...ownerListing,
      role: 'editor',
      permissions: { ...ALL_PERMS, canManageAccess: false },
      expiresAt: '2099-01-01T00:00:00Z',
    };
    const bases = { async getBase() { return expiring; } } as unknown as BaseRepository;
    renderSettings(bases);
    await screen.findByText('Paramètres');
    expect(screen.queryByRole('button', { name: 'Rendre disponible hors-ligne' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer la base' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Modèle d’observation/)).not.toBeInTheDocument();
  });

  test('le modele d observation se verrouille des qu un patient existe', async () => {
    const bases = { async getBase() { return ownerListing; } } as unknown as BaseRepository;
    const patients = { async listPatientsPage() { return { rows: [], total: 3 }; } } as unknown as PatientRepository;
    renderSettings(bases, patients);
    expect(await screen.findByLabelText(/Modèle d’observation/)).toBeDisabled();
  });
});
