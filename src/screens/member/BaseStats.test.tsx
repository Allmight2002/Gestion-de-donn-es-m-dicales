// @vitest-environment jsdom
// D2 : la courbe d'inclusion affiche total/objectif/progression + le graphique, et le
// proprietaire fixe l'objectif.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
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
  total: 12, target: 20, targetDate: '2026-12-01', targetRevision: 7,
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
      async getCompletenessStats() {
        // B1 : les moins completes d'abord.
        return [
          { fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter' as const, filled: 3, total: 10 },
          { fieldKey: 'sexe', label: 'Sexe', scope: 'patient' as const, filled: 8, total: 10 },
        ];
      },
      async getBase() { return listing; },
      setInclusionTarget,
    } as unknown as BaseRepository;

    renderStats(bases);
    expect(await screen.findByText('Patients inclus')).toBeInTheDocument();
    // B1 : la section completude liste les variables avec leur taux.
    expect(screen.getByText('Complétude par variable')).toBeInTheDocument();
    expect(screen.getByText('3 / 10 (30 %)')).toBeInTheDocument(); // Glasgow, en premier (le moins complet)
    expect(screen.getByText('8 / 10 (80 %)')).toBeInTheDocument(); // Sexe
    expect(screen.getAllByText('12').length).toBeGreaterThan(0); // total (carte + dernier point du graphe)
    expect(screen.getByText('60 %')).toBeInTheDocument(); // 12/20
    expect(screen.getByRole('img', { name: 'Courbe d’inclusion' })).toBeInTheDocument(); // le SVG

    // Le proprietaire modifie l'objectif -> enregistre via le repository.
    fireEvent.change(screen.getByLabelText('Objectif'), { target: { value: '30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer l’objectif' }));
    await waitFor(() => expect(setInclusionTarget).toHaveBeenCalledWith('b1', 30, '2026-12-01', 7));
  });

  test('un refus ne declenche aucun succes et affiche une erreur utilisateur', async () => {
    const setInclusionTarget = vi.fn(async () => {
      throw new Error('WRITE_STALE');
    });
    const bases = {
      async getInclusionStats() { return stats; },
      async getCompletenessStats() { return []; },
      async getBase() { return listing; },
      setInclusionTarget,
    } as unknown as BaseRepository;
    renderStats(bases);
    await screen.findByText('Patients inclus');
    fireEvent.change(screen.getByLabelText('Objectif'), { target: { value: '30' } });
    await userEvent.click(screen.getByRole('button', { name: /enregistrer l.objectif/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/modifiees entre-temps/i);
    expect(screen.queryByText('Objectif enregistrÃ©.')).not.toBeInTheDocument();
  });

  test('sans donnees : message d attente, pas de graphique', async () => {
    const bases = {
      async getInclusionStats(): Promise<InclusionStats> {
        return { total: 0, target: null, targetDate: null, targetRevision: 0, monthly: [] };
      },
      async getCompletenessStats() { return []; },
      async getBase() { return { ...listing, role: 'viewer' as const }; },
      setInclusionTarget: vi.fn(),
    } as unknown as BaseRepository;
    renderStats(bases);
    expect(await screen.findByText(/la courbe apparaîtra/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
