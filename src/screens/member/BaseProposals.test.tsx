// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { BaseProposal, BaseRepository } from '../../data/bases';
import { BaseProposals } from './BaseProposals';

const listing = {
  base: { id: 'b1', name: 'Registre', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner' as const,
  permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
  templateName: 'T', versionNumber: 1,
};

const proposals: BaseProposal[] = [
  { fieldKey: 'sexe', label: 'Sexe', scope: 'patient', proposalValue: 'Intersexe', patientId: 'p1', patientCode: 'P-001', encounterId: null, encounterType: null, encounterDate: null, variableTotal: 2 },
  { fieldKey: 'sexe', label: 'Sexe', scope: 'patient', proposalValue: 'Intersexe', patientId: 'p2', patientCode: 'P-002', encounterId: null, encounterType: null, encounterDate: null, variableTotal: 2 },
  { fieldKey: 'outcome', label: 'Évolution', scope: 'encounter', proposalValue: 'Sortie contre avis', patientId: 'p1', patientCode: 'P-001', encounterId: 'e1', encounterType: 'hospitalisation', encounterDate: '2026-08-01', variableTotal: 1 },
];

function renderScreen(bases: BaseRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases}>
        <MemoryRouter initialEntries={['/bases/b1/propositions']}>
          <Routes>
            <Route path="/bases/:id/propositions" element={<BaseProposals />} />
            <Route path="/bases/:id/patients/:patientId" element={<div>FICHE</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('BaseProposals (L12)', () => {
  test('groupe par variable, conserve les doublons et ouvre les fiches source', async () => {
    const bases = {
      async getBase() { return listing; },
      async getBaseProposalsPage() {
        return { items: proposals, total: proposals.length, limit: 50, offset: 0, hasMore: false };
      },
    } as unknown as BaseRepository;
    renderScreen(bases);

    expect(await screen.findByRole('heading', { name: 'Propositions hors liste' })).toBeInTheDocument();
    expect(screen.getByText('Sexe')).toBeInTheDocument();
    expect(screen.getAllByText('Intersexe')).toHaveLength(2);
    expect(screen.getByText('Évolution')).toBeInTheDocument();
    expect(screen.getByText('Hospitalisation · 1 août 2026')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Ouvrir la fiche' });
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute('href', '/bases/b1/patients/p1/encounters/e1/edit');
    expect(links[1]).toHaveAttribute('href', '/bases/b1/patients/p1');
  });

  test('ne charge pas les propositions pour un membre qui n est pas proprietaire', async () => {
    const getBaseProposalsPage = vi.fn();
    const bases = {
      async getBase() { return { ...listing, role: 'viewer' as const }; },
      getBaseProposalsPage,
    } as unknown as BaseRepository;
    renderScreen(bases);

    expect(await screen.findByRole('alert')).toHaveTextContent('réservé au médecin responsable');
    expect(getBaseProposalsPage).not.toHaveBeenCalled();
  });

  test('pagine les occurrences sans charger toute la base', async () => {
    const getBaseProposalsPage = vi.fn(async (_baseId: string, limit: number, offset: number) => ({
      items: offset === 0 ? proposals : [],
      total: 51,
      limit,
      offset,
      hasMore: offset === 0,
    }));
    renderScreen({
      async getBase() { return listing; },
      getBaseProposalsPage,
    } as unknown as BaseRepository);

    await screen.findByRole('heading', { name: 'Propositions hors liste' });
    await userEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    await waitFor(() => expect(getBaseProposalsPage).toHaveBeenLastCalledWith('b1', 50, 50));
  });
});
