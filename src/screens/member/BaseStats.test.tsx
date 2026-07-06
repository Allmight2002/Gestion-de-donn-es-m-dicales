// @vitest-environment jsdom
// D2 : la courbe d'inclusion affiche total/objectif/progression + le graphique, et le
// proprietaire fixe l'objectif.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseStats } from './BaseStats';
import type { BaseRepository, BaseListing, InclusionStats } from '../../data/bases';

const listing: BaseListing = {
  base: { id: 'b1', name: 'Base', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner',
  permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
  templateName: 'Neuro', versionNumber: 1,
};
const stats: InclusionStats = {
  total: 12, target: 20, targetDate: '2026-12-01',
  monthly: [{ month: '2026-01', count: 5 }, { month: '2026-02', count: 7 }],
};

function renderStats(bases: BaseRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases}>
        <MemoryRouter initialEntries={['/bases/b1/stats']}>
          <Routes><Route path="/bases/:id/stats" element={<BaseStats />} /></Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('BaseStats (D2)', () => {
  test('affiche total, objectif, progression et la courbe ; le proprietaire enregistre l objectif', async () => {
    const setInclusionTarget = vi.fn(async () => {});
    const bases = {
      async getInclusionStats() { return stats; },
      async getBase() { return listing; },
      setInclusionTarget,
    } as unknown as BaseRepository;

    renderStats(bases);
    expect(await screen.findByText('Patients inclus')).toBeInTheDocument();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0); // total (carte + dernier point du graphe)
    expect(screen.getByText('60 %')).toBeInTheDocument(); // 12/20
    expect(screen.getByRole('img', { name: 'Courbe d’inclusion' })).toBeInTheDocument(); // le SVG

    // Le proprietaire modifie l'objectif -> enregistre via le repository.
    fireEvent.change(screen.getByLabelText('Objectif'), { target: { value: '30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer l’objectif' }));
    await waitFor(() => expect(setInclusionTarget).toHaveBeenCalledWith('b1', 30, '2026-12-01'));
  });

  test('sans donnees : message d attente, pas de graphique', async () => {
    const bases = {
      async getInclusionStats(): Promise<InclusionStats> { return { total: 0, target: null, targetDate: null, monthly: [] }; },
      async getBase() { return { ...listing, role: 'viewer' as const }; },
      setInclusionTarget: vi.fn(),
    } as unknown as BaseRepository;
    renderStats(bases);
    expect(await screen.findByText(/la courbe apparaîtra/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
