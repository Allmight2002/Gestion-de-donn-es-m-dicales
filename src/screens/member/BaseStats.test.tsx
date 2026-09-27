// @vitest-environment jsdom
// D2 : la courbe d'inclusion affiche total/objectif/progression + le graphique, et le
// proprietaire fixe l'objectif.
// Audit UI mobile, lot 4 (5.8-A/B) : objectif a la demande, completude resumee.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseStats } from './BaseStats';
import type { BaseRepository, BaseListing, CompletenessRow, InclusionStats } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { TemplateField } from '../../data/types';

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

function renderStats(bases: BaseRepository, templates?: TemplateRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases} {...(templates ? { templates } : {})}>
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

    // Deux portees : chaque ligne dit la sienne.
    expect(screen.getByText('Rencontre')).toBeInTheDocument();
    expect(screen.getByText('Patient (permanent)')).toBeInTheDocument();

    // Le proprietaire ouvre le reglage de l'objectif a la demande, puis l'enregistre.
    const toggle = screen.getByRole('button', { name: /Objectif de recrutement/ });
    expect(toggle).toHaveTextContent('Modifier');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Objectif')).not.toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Objectif')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Objectif'), { target: { value: '30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer l’objectif' }));
    await waitFor(() => expect(setInclusionTarget).toHaveBeenCalledWith('b1', 30, '2026-12-01', 7));
    // Enregistre : le reglage se referme.
    await waitFor(() => expect(screen.getByRole('button', { name: /Objectif de recrutement/ }))
      .toHaveAttribute('aria-expanded', 'false'));
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
    await userEvent.click(screen.getByRole('button', { name: /Objectif de recrutement/ }));
    fireEvent.change(screen.getByLabelText('Objectif'), { target: { value: '30' } });
    await userEvent.click(screen.getByRole('button', { name: /enregistrer l.objectif/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/modifiees entre-temps/i);
    // Refuse : le reglage reste ouvert avec la saisie, pour reessayer.
    expect(screen.getByLabelText('Objectif')).toHaveValue(30);
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
    // Lecteur : pas de reglage d'objectif.
    expect(screen.queryByRole('button', { name: /Objectif de recrutement/ })).not.toBeInTheDocument();
  });

  // Douze variables du meme formulaire (v1), les moins renseignees d'abord comme le serveur.
  const row = (fieldKey: string, label: string, filled: number): CompletenessRow => ({
    mode: 'historical', templateVersionId: 'v1', versionNumber: 1, fieldKey, label,
    scope: 'patient', observed: filled, missingCoded: 0, filled, total: 10,
  });
  const rows = [
    row('glasgow', 'Glasgow', 0), row('pupilles', 'Pupilles', 0), row('creat', 'Créatinine', 2),
    row('natremie', 'Natrémie', 3), row('scanner', 'Scanner', 4), row('irm', 'IRM', 5),
    row('poids', 'Poids', 6), row('taille', 'Taille', 7), row('sexe', 'Sexe', 8),
    row('age', 'Âge', 9), row('tabac', 'Tabac', 10), row('atcd', 'Antécédents', 10),
  ];
  const field = (fieldKey: string, section: string, sectionLabel: string, sectionOrder: number) =>
    ({ fieldKey, scope: 'patient', section, sectionLabel, sectionOrder }) as TemplateField;
  // `atcd` n'est pas dans la version : il tombe dans la section de secours, sans disparaitre.
  const fields = [
    ...['glasgow', 'pupilles', 'scanner', 'irm'].map((k) => field(k, 'neuro', 'Neurologie', 2)),
    ...['creat', 'natremie'].map((k) => field(k, 'bilan', 'Bilan biologique', 1)),
    ...['poids', 'taille', 'sexe', 'age', 'tabac'].map((k) => field(k, 'general', 'Général', 0)),
  ];
  const completenessBases = () => ({
    async getInclusionStats() { return stats; },
    async getCompletenessStats() { return rows; },
    async getBase() { return { ...listing, role: 'viewer' as const }; },
    setInclusionTarget: vi.fn(),
  }) as unknown as BaseRepository;
  const shownLabels = () => screen.getAllByRole('listitem').map((li) => li.querySelector('span')?.firstChild?.textContent);

  test('completude resumee : pastilles, 10 moins renseignees, puis toutes par section avec recherche', async () => {
    const getFields = vi.fn(async () => fields);
    renderStats(completenessBases(), { getFields } as unknown as TemplateRepository);

    expect(await screen.findByText('2 à 0 %')).toBeInTheDocument();
    // Une seule portee et une seule version : pas de repere repete sur chaque ligne.
    expect(screen.queryByText('Patient (permanent)')).not.toBeInTheDocument();
    expect(screen.queryByText('v1')).not.toBeInTheDocument();
    expect(screen.getByText('8 partielles')).toBeInTheDocument();
    expect(screen.getByText('2 complètes')).toBeInTheDocument();
    // Les 10 moins renseignees seulement, sans lecture du formulaire.
    expect(shownLabels()).toEqual(['Glasgow', 'Pupilles', 'Créatinine', 'Natrémie', 'Scanner', 'IRM', 'Poids', 'Taille', 'Sexe', 'Âge']);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(getFields).not.toHaveBeenCalled();

    const more = screen.getByRole('button', { name: 'Voir les 12 variables' });
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveTextContent('Voir les 10 moins renseignées');
    // Toutes, par section dans l'ordre du formulaire, la section de secours en dernier ; dans
    // chaque section, l'ordre du serveur est garde.
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent))
      .toEqual(['Général', 'Bilan biologique', 'Neurologie', 'Autre']));
    expect(getFields).toHaveBeenCalledWith('v1');
    expect(within(screen.getByRole('region', { name: 'Neurologie' })).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual([expect.stringMatching(/^Glasgow/), expect.stringMatching(/^Pupilles/), expect.stringMatching(/^Scanner/), expect.stringMatching(/^IRM/)]);
    expect(within(screen.getByRole('region', { name: 'Autre' })).getByText('Antécédents')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(12);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Rechercher une variable' }), 'natr');
    expect(shownLabels()).toEqual(['Natrémie']);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Bilan biologique']);
    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('Aucune variable ne correspond.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    await userEvent.click(more);
    expect(shownLabels()).toHaveLength(10);
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  test('sections illisibles : « Voir toutes » garde une liste simple, sans erreur', async () => {
    const getFields = vi.fn(async () => { throw new Error('RLS'); });
    renderStats(completenessBases(), { getFields } as unknown as TemplateRepository);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir les 12 variables' }));
    await waitFor(() => expect(getFields).toHaveBeenCalled());
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('plusieurs versions : chaque ligne dit sa version', async () => {
    const bases = {
      async getInclusionStats() { return stats; },
      async getCompletenessStats() {
        return [
          { ...row('glasgow', 'Glasgow', 2), templateVersionId: 'v1', versionNumber: 1 },
          { ...row('glasgow', 'Glasgow', 6), templateVersionId: 'v2', versionNumber: 2 },
        ];
      },
      async getBase() { return listing; },
      setInclusionTarget: vi.fn(),
    } as unknown as BaseRepository;
    renderStats(bases);
    expect(await screen.findByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.queryByText('Patient (permanent)')).not.toBeInTheDocument();
  });
});
