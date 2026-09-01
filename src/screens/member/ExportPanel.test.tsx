// @vitest-environment jsdom
// Test de rendu de l'export (cahier §9.2/§9.3) avec repos INJECTES.
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ExportPanel } from './ExportPanel';
import type { BaseRepository, BaseListing, ObservationModel } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { ExportRepository, RecordExportInput, ExportLogItem } from '../../data/exports';
import type { CohortRepository } from '../../data/cohorts';
import type { AuditRepository } from '../../data/audit';
import type { TemplateField } from '../../data/types';

beforeAll(() => {
  // jsdom n'implemente pas createObjectURL ; le composant le protege deja par try/catch.
  if (!('createObjectURL' in URL)) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  if (!('revokeObjectURL' in URL)) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

function listingFor(observationModel: ObservationModel): BaseListing {
  return {
    base: { id: 'b1', name: 'Base', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1', observationModel },
    role: 'owner', permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true }, templateName: 'Neuro', versionNumber: 1,
  };
}
const baseListing: BaseListing = listingFor('longitudinal');
function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'type' | 'scope'>): TemplateField {
  return { id: p.fieldKey, section: 'clinique', unit: null, allowedValues: null, required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...p };
}
const baseRepo = { async getBase() { return baseListing; } } as unknown as BaseRepository;
const templateRepo = {
  async getVersion() {
    return {
      version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
      fields: [
        field({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select' }),
        field({ fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', type: 'integer' }),
      ],
      rules: [],
    };
  },
} as unknown as TemplateRepository;

describe('ExportPanel', () => {
  test('genere et conserve un export CSV (trace recordExport)', async () => {
    const recordExport = vi.fn(async (_i: RecordExportInput): Promise<ExportLogItem> => ({
      id: 'x', format: 'csv', exportedAt: '2024-01-01', patientCount: 1, encounterCount: 1, fileHash: 'deadbeef', storedFilePath: null,
    }));
    const exportsRepo = {
      recordExport,
      async listExports() { return []; },
    } as unknown as ExportRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={templateRepo} exports={exportsRepo}>
          <MemoryRouter initialEntries={['/bases/b1/cohorts/c1/export']}>
            <Routes>
              <Route path="/bases/:id/cohorts/:cohortId/export" element={<ExportPanel />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    await screen.findByText('Exporter une cohorte');
    await userEvent.click(screen.getByRole('button', { name: 'Exporter les données' }));

    await waitFor(() => expect(recordExport).toHaveBeenCalledTimes(1));
    const arg = recordExport.mock.calls[0][0];
    expect(arg.format).toBe('csv');
    expect(arg.profile).toBe('analysis');
    expect(arg.options).toMatchObject({ mode: 'encounter', rule: 'last', scope: 'matching' });
    expect('content' in arg).toBe(false);
  });

  // La forme des lignes n'est une QUESTION que la ou elle en est une : le modele
  // d'observation est verrouille des la premiere saisie, l'ecran en deduit le reste.
  async function exportWithModel(observationModel: ObservationModel) {
    const recordExport = vi.fn(async (_i: RecordExportInput): Promise<ExportLogItem> => ({
      id: 'x', format: 'csv', exportedAt: '2024-01-01', patientCount: 1, encounterCount: 1, fileHash: 'deadbeef', storedFilePath: null,
    }));
    const modelRepo = { async getBase() { return listingFor(observationModel); } } as unknown as BaseRepository;
    const exportsRepo = { recordExport, async listExports() { return []; } } as unknown as ExportRepository;
    render(
      <I18nProvider>
        <RepositoryProvider bases={modelRepo} templates={templateRepo} exports={exportsRepo}>
          <MemoryRouter initialEntries={['/bases/b1/cohorts/c1/export']}>
            <Routes>
              <Route path="/bases/:id/cohorts/:cohortId/export" element={<ExportPanel />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
    await screen.findByText('Exporter une cohorte');
    return recordExport;
  }

  test('une seule saisie par participant : la forme est annoncee, plus demandee', async () => {
    const recordExport = await exportWithModel('cross_sectional');
    await screen.findByText('Une ligne par participant');
    expect(screen.queryByRole('combobox', { name: /type d'export/i })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /agrégation/i })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Exporter les données' }));
    await waitFor(() => expect(recordExport).toHaveBeenCalledTimes(1));
    expect(recordExport.mock.calls[0][0].options).toMatchObject({ mode: 'patient', scope: 'matching' });
  });

  test('registre d\'evenements : une ligne par evenement, sans question', async () => {
    const recordExport = await exportWithModel('event_registry');
    await screen.findByText('Une ligne par événement');
    expect(screen.queryByRole('combobox', { name: /type d'export/i })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Exporter les données' }));
    await waitFor(() => expect(recordExport).toHaveBeenCalledTimes(1));
    expect(recordExport.mock.calls[0][0].options).toMatchObject({ mode: 'encounter' });
  });

  test('suivi longitudinal : la question reste posee, elle a un sens', async () => {
    await exportWithModel('longitudinal');
    expect(screen.getByRole('combobox', { name: /type d'export/i })).toBeTruthy();
    expect(screen.queryByText('Une ligne par participant')).toBeNull();
  });

  test('permet de choisir le profil complet et le format XLSX', async () => {
    const recordExport = await exportWithModel('longitudinal');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /profil de données/i }),
      'complete',
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /format/i }), 'xlsx');

    await userEvent.click(screen.getByRole('button', { name: 'Exporter les données' }));
    await waitFor(() => expect(recordExport).toHaveBeenCalledTimes(1));
    expect(recordExport.mock.calls[0][0]).toMatchObject({ profile: 'complete', format: 'xlsx' });
  });

  // Parcours principal : l'export ne demande plus de constituer une cohorte. Le figeage a
  // toujours lieu -- il cesse d'etre une demarche a la charge du medecin.
  test('sans cohorte : la population est figee a la volee, puis exportee', async () => {
    const createSnapshot = vi.fn(async () => ({ id: 'auto-1' }));
    const recordExport = vi.fn(async (_i: RecordExportInput): Promise<ExportLogItem> => ({
      id: 'x', format: 'csv', exportedAt: '2024-01-01', patientCount: 4, encounterCount: 6, fileHash: 'deadbeef', storedFilePath: null,
    }));
    const listBaseExports = vi.fn(async () => []);
    const exportsRepo = { recordExport, async listExports() { return []; }, listBaseExports } as unknown as ExportRepository;
    const cohortsRepo = { createSnapshot } as unknown as CohortRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={templateRepo} exports={exportsRepo} cohorts={cohortsRepo}>
          <MemoryRouter initialEntries={['/bases/b1/export']}>
            <Routes>
              <Route path="/bases/:id/export" element={<ExportPanel />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    await screen.findByRole('heading', { name: 'Exporter les données' });
    // L'historique est celui de la BASE : sans cohorte, il n'y a pas de cohorte a interroger.
    await waitFor(() => expect(listBaseExports).toHaveBeenCalledWith('b1'));

    await userEvent.click(screen.getByRole('button', { name: 'Exporter les données' }));
    await waitFor(() => expect(recordExport).toHaveBeenCalledTimes(1));
    expect(createSnapshot).toHaveBeenCalledWith(
      'b1',
      expect.stringContaining('Toutes les données'),
      { conditions: [] },
      false,
    );
    expect(recordExport.mock.calls[0][0].cohortId).toBe('auto-1');
    expect(recordExport.mock.calls[0][0].profile).toBe('analysis');
  });

  test('telecharge un export conserve via URL signee (et trace best-effort en local)', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const getExportDownloadUrl = vi.fn(async () => 'https://signed.test/export.csv');
    const logExportRead = vi.fn(async () => {});
    const exportsRepo = {
      async recordExport() {
        return {
          id: 'x', format: 'csv', exportedAt: '2024-01-01', patientCount: 0, encounterCount: 0, fileHash: 'deadbeef', storedFilePath: 'p',
        };
      },
      async listExports() {
        return [{
          id: 'x', format: 'csv', exportedAt: '2024-01-01', patientCount: 1, encounterCount: 2, fileHash: 'deadbeef', storedFilePath: 'b/c/export.csv',
          fileName: 'meddata_base_cohorte_patients_2024-01-01_08-30-00Z.csv',
          profile: 'complete',
        }];
      },
      getExportDownloadUrl,
    } as unknown as ExportRepository;

    render(
      <I18nProvider>
        <RepositoryProvider
          bases={baseRepo}
          templates={templateRepo}
          exports={exportsRepo}
          audit={{ logExportRead } as unknown as AuditRepository}
        >
          <MemoryRouter initialEntries={['/bases/b1/cohorts/c1/export']}>
            <Routes>
              <Route path="/bases/:id/cohorts/:cohortId/export" element={<ExportPanel />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    const historyHash = await screen.findByText(/deadbeef/);
    const historyEntry = historyHash.closest('li');
    expect(historyEntry).not.toBeNull();
    expect(within(historyEntry as HTMLLIElement).getByText(/Complet — structure actuelle/)).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(getExportDownloadUrl).toHaveBeenCalledWith('x', 'b/c/export.csv'));
    expect(anchorClick).toHaveBeenCalledOnce();
    const downloadLink = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(downloadLink.href).toBe('https://signed.test/export.csv');
    expect(downloadLink.download).toBe('meddata_base_cohorte_patients_2024-01-01_08-30-00Z.csv');
    expect(downloadLink.rel).toBe('noopener');
    // En local/demo (pas d'Edge), le telechargement laisse une trace via la RPC log_export_read.
    await waitFor(() => expect(logExportRead).toHaveBeenCalledWith('x'));
  });
});
