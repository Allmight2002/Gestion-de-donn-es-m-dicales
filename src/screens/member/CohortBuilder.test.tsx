// @vitest-environment jsdom
// Tests de rendu du constructeur de cohorte (cahier §8.9) avec repos INJECTES.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { CohortBuilder } from './CohortBuilder';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { CohortRepository, FilterDefinition } from '../../data/cohorts';
import type { TemplateField } from '../../data/types';

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
        field({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'] }),
        field({ fieldKey: 'poids', label: 'Poids', scope: 'patient', type: 'number' }),
      ],
      rules: [],
    };
  },
} as unknown as TemplateRepository;

function makeCohorts(over: Partial<CohortRepository> = {}): CohortRepository {
  return {
    async listCohorts() { return []; },
    async preview() { return { patientCount: 5, encounterCount: 6 }; },
    async createDynamic() { return { id: 'c1' }; },
    async createSnapshot() { return { id: 'c1' }; },
    ...over,
  } as unknown as CohortRepository;
}

function renderBuilder(cohorts: CohortRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={baseRepo} templates={templateRepo} cohorts={cohorts}>
        <MemoryRouter initialEntries={['/bases/b1/cohorts']}>
          <Routes>
            <Route path="/bases/:id/cohorts" element={<CohortBuilder />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('CohortBuilder', () => {
  test('ajoute un filtre, calcule les effectifs, et enregistre une cohorte figee', async () => {
    const preview = vi.fn(async (_b: string, _f: FilterDefinition) => ({ patientCount: 5, encounterCount: 6 }));
    const createSnapshot = vi.fn(async (_b: string, _n: string, _f: FilterDefinition) => ({ id: 'c1' }));
    renderBuilder(makeCohorts({ preview, createSnapshot }));

    await screen.findByRole('heading', { name: 'Cohortes' });
    fireEvent.change(screen.getByLabelText('Valeur'), { target: { value: 'M' } });
    await userEvent.click(screen.getByRole('button', { name: /ajouter ce critère/i }));
    expect(screen.getByRole('button', { name: 'Retirer' })).toBeInTheDocument(); // filtre ajoute

    await userEvent.click(screen.getByRole('button', { name: 'Voir le résultat' }));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect((preview.mock.calls[0][1] as FilterDefinition).conditions).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Nom de la cohorte'), { target: { value: 'Cohorte M' } });
    await userEvent.click(screen.getByRole('button', { name: 'Créer la cohorte' }));
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(createSnapshot.mock.calls[0][1]).toBe('Cohorte M');
  });

  test('audit externe : une valeur non numerique sur un champ nombre est refusee AVANT l ajout', async () => {
    renderBuilder(makeCohorts());
    await screen.findByRole('heading', { name: 'Cohortes' });

    // Champ « Poids » (number) + valeur texte -> erreur explicite, PAS de filtre ajoute
    // (cote base, value_cmp replierait en tri lexical silencieux).
    fireEvent.change(screen.getByLabelText('Variable'), { target: { value: 'poids' } });
    fireEvent.change(screen.getByLabelText('Valeur'), { target: { value: 'abc' } });
    await userEvent.click(screen.getByRole('button', { name: /ajouter ce critère/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Poids.*num/i);
    expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull();

    // Virgule decimale toleree : « 12,5 » passe et est normalisee en « 12.5 ».
    fireEvent.change(screen.getByLabelText('Valeur'), { target: { value: '12,5' } });
    await userEvent.click(screen.getByRole('button', { name: /ajouter ce critère/i }));
    expect(screen.getByRole('button', { name: 'Retirer' })).toBeInTheDocument();
    expect(screen.getByText(/12\.5/)).toBeInTheDocument();
  });

  test('modifier les criteres invalide les effectifs avant l enregistrement', async () => {
    renderBuilder(makeCohorts());
    await screen.findByRole('heading', { name: 'Cohortes' });

    fireEvent.change(screen.getByLabelText('Valeur'), { target: { value: 'F' } });
    await userEvent.click(screen.getByRole('button', { name: /ajouter ce critère/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Voir le résultat' }));

    expect(await screen.findByLabelText('Nom de la cohorte')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retirer' }));

    expect(screen.queryByLabelText('Nom de la cohorte')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voir le résultat' })).toHaveClass('btn-primary');
  });
});
