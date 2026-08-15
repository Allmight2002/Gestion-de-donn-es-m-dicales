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

// L30 — la conversion des valeurs orphelines est un OPT-IN en deux gestes : analyser ne
// modifie rien, convertir ne part qu'au second clic. Une valeur non rapprochable est
// affichee telle quelle et n'est jamais devinee.
describe('BaseSettings — conversion des codes d options (L30)', () => {
  const previewAvecOrphelines = {
    records: { repairable: 2, blocked: 1 },
    fields: [{
      entity: 'encounter' as const,
      fieldKey: 'evolution',
      label: 'Évolution',
      repairableRecords: 2,
      blockedRecords: 1,
      mappings: [{ from: 'hematome', to: 'hématome', occurrences: 2 }],
      blockingValues: [{ value: 'traumatisme crânien', occurrences: 1 }],
    }],
  };

  function repo(over: Partial<BaseRepository>) {
    return { async getBase() { return ownerListing; }, ...over } as unknown as BaseRepository;
  }

  test('analyser n appelle jamais la conversion et montre ce qui sera fait', async () => {
    const user = userEvent.setup();
    const previewOptionKeyRepair = vi.fn(async () => previewAvecOrphelines);
    const repairOptionKeys = vi.fn();
    renderSettings(repo({ previewOptionKeyRepair, repairOptionKeys }));

    await user.click(await screen.findByRole('button', { name: 'Analyser les fiches' }));

    expect(previewOptionKeyRepair).toHaveBeenCalledWith('b1');
    expect(repairOptionKeys).not.toHaveBeenCalled();
    expect(await screen.findByText(/« hematome »/)).toBeInTheDocument();
    expect(screen.getByText(/traumatisme crânien/)).toBeInTheDocument();
  });

  test('convertir n est propose qu apres l analyse, et rejoue l apercu ensuite', async () => {
    const user = userEvent.setup();
    const previewOptionKeyRepair = vi.fn()
      .mockResolvedValueOnce(previewAvecOrphelines)
      .mockResolvedValue({ records: { repairable: 0, blocked: 1 }, fields: previewAvecOrphelines.fields });
    const repairOptionKeys = vi.fn(async () => ({
      repairedRecords: 2, repairedFields: 2, blockedRecords: 1, skippedRecords: 0, failedRecords: 0,
    }));
    renderSettings(repo({ previewOptionKeyRepair, repairOptionKeys }));

    expect(screen.queryByRole('button', { name: 'Convertir les fiches' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Analyser les fiches' }));
    await user.click(await screen.findByRole('button', { name: 'Convertir les fiches' }));

    expect(repairOptionKeys).toHaveBeenCalledWith('b1');
    expect(await screen.findByRole('status')).toHaveTextContent('2 fiche(s) converties');
    // L'apercu est rejoue : ce qui reste a l'ecran est l'etat reel, pas la photo d'avant.
    expect(previewOptionKeyRepair).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Convertir les fiches' })).toBeNull();
  });

  test('rien a convertir : le dit, et n offre pas la conversion', async () => {
    const user = userEvent.setup();
    const previewOptionKeyRepair = vi.fn(async () => ({ records: { repairable: 0, blocked: 0 }, fields: [] }));
    renderSettings(repo({ previewOptionKeyRepair }));

    await user.click(await screen.findByRole('button', { name: 'Analyser les fiches' }));
    expect(await screen.findByText(/Aucune fiche à convertir/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convertir les fiches' })).toBeNull();
  });
});
