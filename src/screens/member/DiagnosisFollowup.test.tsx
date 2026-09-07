// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { BaseRepository, DiagnosisFollowupItem } from '../../data/bases';
import { DiagnosisFollowup } from './DiagnosisFollowup';

const listing = {
  base: { id: 'b1', name: 'Registre', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v2' },
  role: 'owner' as const,
  permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
  templateName: 'T', versionNumber: 2,
};

const items: DiagnosisFollowupItem[] = [
  {
    scope: 'patient', patientId: 'p1', patientCode: 'P-001', encounterId: null, encounterType: null,
    encounterDate: null, status: 'draft', sourceVersionId: 'v1', sourceVersionNumber: 1,
    onCurrentVersion: false, counts: { covered: 0, common_only: 0, uncovered: 1, unclassified: 0 },
    uncoveredCodes: ['C42'], codesCoveredInCurrentVersion: ['C42'],
  },
  {
    scope: 'encounter', patientId: 'p2', patientCode: 'P-002', encounterId: 'e9', encounterType: 'hospitalisation',
    encounterDate: '2026-08-01', status: 'complete', sourceVersionId: 'v2', sourceVersionNumber: 2,
    onCurrentVersion: true, counts: { covered: 1, common_only: 0, uncovered: 0, unclassified: 1 },
    uncoveredCodes: [], codesCoveredInCurrentVersion: [],
  },
];

const page = {
  items, total: 2, limit: 50, offset: 0, hasMore: false,
  unclassifiedRecords: 1, byCode: [{ code: 'C42', records: 1 }], currentVersionId: 'v2',
};

function renderScreen(bases: BaseRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases}>
        <MemoryRouter initialEntries={['/bases/b1/diagnostics']}>
          <Routes>
            <Route path="/bases/:id/diagnostics" element={<DiagnosisFollowup />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('DiagnosisFollowup (L56)', () => {
  test('liste les cas non couverts, leurs agregats et l evolution du gabarit', async () => {
    const bases = {
      async getBase() { return listing; },
      async getDiagnosisFollowupPage() { return page; },
    } as unknown as BaseRepository;
    renderScreen(bases);

    expect(await screen.findByRole('heading', { name: 'Diagnostics sans bloc' })).toBeInTheDocument();
    expect(screen.getByText('P-001')).toBeInTheDocument();
    expect(screen.getByText('Hospitalisation · 1 août 2026')).toBeInTheDocument();
    // Agregats : un code et un compte, jamais un libelle ni un texte de proposition.
    expect(screen.getAllByText(/1 dossier\(s\)/)).toHaveLength(2); // le code C42, et les propositions
    expect(screen.getAllByText('C42').length).toBeGreaterThan(0);
    // Evolution du gabarit : signalee, et explicitement SANS reprise automatique.
    expect(screen.getByText(/Aucune reprise automatique/)).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: 'Ouvrir la fiche' });
    expect(links[0]).toHaveAttribute('href', '/bases/b1/patients/p1');
    expect(links[1]).toHaveAttribute('href', '/bases/b1/patients/p2/encounters/e9/edit');
  });

  test('transmet portee, code et version courante a la RPC', async () => {
    const getDiagnosisFollowupPage = vi.fn(async () => page);
    const bases = {
      async getBase() { return listing; },
      getDiagnosisFollowupPage,
    } as unknown as BaseRepository;
    renderScreen(bases);
    await screen.findByText('P-001');
    expect(getDiagnosisFollowupPage).toHaveBeenLastCalledWith(
      'b1', { scope: null, code: null, versionId: null }, 50, 0,
    );

    await userEvent.selectOptions(screen.getByLabelText('Fiche concernée'), 'encounter');
    await waitFor(() => expect(getDiagnosisFollowupPage).toHaveBeenLastCalledWith(
      'b1', { scope: 'encounter', code: null, versionId: null }, 50, 0,
    ));

    await userEvent.selectOptions(screen.getByLabelText('Code diagnostique'), 'C42');
    await waitFor(() => expect(getDiagnosisFollowupPage).toHaveBeenLastCalledWith(
      'b1', { scope: 'encounter', code: 'C42', versionId: null }, 50, 0,
    ));

    // « Version courante seulement » n'est qu'un filtre de lecture : la file continue de
    // s'evaluer dans la version SOURCE de chaque dossier.
    await userEvent.selectOptions(screen.getByLabelText('Version du dossier'), 'current');
    await waitFor(() => expect(getDiagnosisFollowupPage).toHaveBeenLastCalledWith(
      'b1', { scope: 'encounter', code: 'C42', versionId: 'v2' }, 50, 0,
    ));
  });

  test('ne charge rien pour un membre qui n est pas proprietaire', async () => {
    const getDiagnosisFollowupPage = vi.fn();
    const bases = {
      async getBase() { return { ...listing, role: 'viewer' as const }; },
      getDiagnosisFollowupPage,
    } as unknown as BaseRepository;
    renderScreen(bases);

    expect(await screen.findByRole('alert')).toHaveTextContent('réservé au médecin responsable');
    expect(getDiagnosisFollowupPage).not.toHaveBeenCalled();
  });
});
