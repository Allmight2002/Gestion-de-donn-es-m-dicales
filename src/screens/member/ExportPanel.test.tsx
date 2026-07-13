// @vitest-environment jsdom
// Test de rendu de l'export (cahier §9.2/§9.3) avec repos INJECTES.
import { describe, expect, test, vi, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ExportPanel } from './ExportPanel';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { ExportRepository, RecordExportInput, ExportLogItem } from '../../data/exports';
import type { AuditRepository } from '../../data/audit';
import type { TemplateField } from '../../data/types';

beforeAll(() => {
  // jsdom n'implemente pas createObjectURL ; le composant le protege deja par try/catch.
  if (!('createObjectURL' in URL)) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  if (!('revokeObjectURL' in URL)) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

const baseListing: BaseListing = {
  base: { id: 'b1', name: 'Base', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner', permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true }, templateName: 'Neuro', versionNumber: 1,
};
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
    await userEvent.click(screen.getByRole('button', { name: 'Générer et conserver' }));

    await waitFor(() => expect(recordExport).toHaveBeenCalledTimes(1));
    const arg = recordExport.mock.calls[0][0];
    expect(arg.format).toBe('csv');
    expect(arg.options).toMatchObject({ mode: 'encounter', rule: 'last', scope: 'matching' });
    expect('content' in arg).toBe(false);
  });

  test('telecharge un export conserve via URL signee (et trace best-effort en local)', async () => {
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

    await screen.findByText(/deadbeef/);
    const buttons = screen.getAllByRole('button');
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(getExportDownloadUrl).toHaveBeenCalledWith('x', 'b/c/export.csv'));
    // En local/demo (pas d'Edge), le telechargement laisse une trace via la RPC log_export_read.
    await waitFor(() => expect(logExportRead).toHaveBeenCalledWith('x'));
  });
});
