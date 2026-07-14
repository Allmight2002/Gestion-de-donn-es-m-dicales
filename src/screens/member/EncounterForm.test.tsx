// @vitest-environment jsdom
// Tests de rendu de la saisie de rencontre (cahier §8.5, §10) avec repos INJECTES.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { EncounterForm } from './EncounterForm';
import { saveDraft, loadDraft } from '../../data/drafts';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository, NewEncounterInput } from '../../data/patients';
import type { TemplateField } from '../../data/types';

const baseListing: BaseListing = {
  base: { id: 'b1', name: 'Base', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner', permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true }, templateName: 'Neuro', versionNumber: 1,
};

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'type'>): TemplateField {
  return {
    id: p.fieldKey, scope: 'encounter', section: 'clinique', unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...p,
  };
}

const baseRepo = { async getBase() { return baseListing; } } as unknown as BaseRepository;
const templateRepo = {
  async getVersion() {
    return {
      version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
      fields: [
        field({ fieldKey: 'admission_date', label: 'Admission', type: 'date', displayOrder: 0 }),
        field({ fieldKey: 'discharge_date', label: 'Sortie', type: 'date', displayOrder: 1 }),
        field({ fieldKey: 'glasgow_score', label: 'Glasgow', type: 'integer', required: true, minValue: 3, maxValue: 15, displayOrder: 2 }),
        field({ fieldKey: 'hemoglobin', label: 'Hemoglobine', type: 'number', allowMissingCodes: true, section: 'biologie', displayOrder: 3 }),
      ],
      rules: [
        { id: 'r1', rule: { operator: 'greater_or_equal', left_field: 'discharge_date', right_field: 'admission_date' }, message: 'sortie >= admission', severity: 'block' as const },
      ],
    };
  },
} as unknown as TemplateRepository;

function makePatientRepo(createEncounter: PatientRepository['createEncounter']): PatientRepository {
  return {
    async listPatients() { return []; },
    async createPatient() { return { id: '', code: '' }; },
    async computeAge() { return 44; },
    createEncounter,
  } as unknown as PatientRepository;
}

function renderForm(patientRepo: PatientRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={baseRepo} templates={templateRepo} patients={patientRepo}>
        <MemoryRouter initialEntries={['/bases/b1/patients/p1/encounters/new']}>
          <Routes>
            <Route path="/bases/:id/patients/:patientId/encounters/new" element={<EncounterForm />} />
            <Route path="/bases/:id/patients/:patientId" element={<div>FICHE PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('EncounterForm', () => {
  afterEach(() => localStorage.clear()); // A4 : pas de fuite de brouillon entre tests

  test('affiche les champs de rencontre, l apercu d age et le selecteur de valeur manquante', async () => {
    renderForm(makePatientRepo(vi.fn(async () => ({ id: 'e1' }))));
    expect(await screen.findByText('Glasgow')).toBeInTheDocument();
    // Apercu d'age calcule (computeAge mock = 44) apres saisie de la date.
    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2024-06-01' } });
    expect(await screen.findByText('44')).toBeInTheDocument();
    // Selecteur de valeur manquante present pour un champ qui l'autorise.
    expect(screen.getByLabelText(/valeur manquante/i)).toBeInTheDocument();
  });

  test('cree la rencontre quand la saisie est valide', async () => {
    const createEncounter = vi.fn(async (_id: string, _input: NewEncounterInput) => ({ id: 'e1' }));
    renderForm(makePatientRepo(createEncounter));
    await screen.findByText('Glasgow');
    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2024-06-01' } });
    fireEvent.change(screen.getByLabelText('Glasgow'), { target: { value: '10' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    expect(await screen.findByText('FICHE PAGE')).toBeInTheDocument();
    expect(createEncounter).toHaveBeenCalledTimes(1);
  });

  test('un draft incomplet est accepte mais une valeur renseignee hors bornes reste refusee', async () => {
    const createEncounter = vi.fn(async (_id: string, _input: NewEncounterInput) => ({ id: 'e1' }));
    renderForm(makePatientRepo(createEncounter));
    await screen.findByText('Glasgow');
    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2024-06-01' } });

    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    await waitFor(() => expect(createEncounter).toHaveBeenCalledTimes(1));
    expect(createEncounter.mock.calls[0][1]).toEqual(expect.objectContaining({
      validationStatus: 'draft',
      data: {},
    }));

    const invalidCreate = vi.fn(async (_id: string, _input: NewEncounterInput) => ({ id: 'e2' }));
    renderForm(makePatientRepo(invalidCreate));
    await screen.findAllByText('Glasgow');
    const dates = screen.getAllByLabelText('Date de la rencontre');
    const glasgows = screen.getAllByLabelText('Glasgow');
    fireEvent.change(dates.at(-1)!, { target: { value: '2024-06-02' } });
    fireEvent.change(glasgows.at(-1)!, { target: { value: '99' } });
    const saveButtons = screen.getAllByRole('button', { name: 'Enregistrer la rencontre' });
    await userEvent.click(saveButtons.at(-1)!);
    expect(await screen.findByText(/valeur maximale/i)).toBeInTheDocument();
    expect(invalidCreate).not.toHaveBeenCalled();
  });

  test('curated incomplet est refuse et curated conforme est accepte', async () => {
    const createEncounter = vi.fn(async (_id: string, _input: NewEncounterInput) => ({ id: 'e1' }));
    renderForm(makePatientRepo(createEncounter));
    await screen.findByText('Glasgow');
    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2024-06-01' } });
    fireEvent.change(screen.getByLabelText(/statut du dossier/i), { target: { value: 'curated' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    expect(await screen.findByText(/champ obligatoire/i)).toBeInTheDocument();
    expect(createEncounter).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Glasgow'), { target: { value: '10' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    await waitFor(() => expect(createEncounter).toHaveBeenCalledTimes(1));
    expect(createEncounter.mock.calls[0][1]).toEqual(expect.objectContaining({ validationStatus: 'curated' }));
  });

  test('A2 : Ctrl+Entrée enregistre la rencontre depuis le clavier', async () => {
    const createEncounter = vi.fn(async (_id: string, _input: NewEncounterInput) => ({ id: 'e1' }));
    const { container } = renderForm(makePatientRepo(createEncounter));
    await screen.findByText('Glasgow');
    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2024-06-01' } });
    fireEvent.change(screen.getByLabelText('Glasgow'), { target: { value: '10' } });
    // Ctrl+Entrée depuis le formulaire (sans cliquer le bouton) déclenche le même enregistrement.
    fireEvent.keyDown(container.querySelector('form')!, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByText('FICHE PAGE')).toBeInTheDocument();
    expect(createEncounter).toHaveBeenCalledTimes(1);
  });

  test('A4 : restaure un brouillon local et l efface a l enregistrement', async () => {
    // Brouillon pre-existant (analytique) pour ce patient (owner vide : pas d'AuthProvider ici).
    saveDraft('encounter', 'p1', { encounterType: 'suivi', encounterDate: '2024-05-05', status: 'draft', values: { glasgow_score: 12 } });
    const createEncounter = vi.fn(async (_id: string, _input: NewEncounterInput) => ({ id: 'e1' }));
    renderForm(makePatientRepo(createEncounter));

    // Bandeau de restauration + valeurs du brouillon reinjectees.
    expect(await screen.findByText(/brouillon récupéré/i)).toBeInTheDocument();
    expect((screen.getByLabelText('Date de la rencontre') as HTMLInputElement).value).toBe('2024-05-05');
    expect((screen.getByLabelText('Glasgow') as HTMLInputElement).value).toBe('12');

    // Enregistrement reussi -> le brouillon est efface.
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    await waitFor(() => expect(createEncounter).toHaveBeenCalledTimes(1));
    expect(loadDraft('encounter', 'p1')).toBeNull();
  });

  test('une regle de coherence bloquante empeche l enregistrement', async () => {
    const createEncounter = vi.fn(async (_id: string, _input: NewEncounterInput) => ({ id: 'e1' }));
    renderForm(makePatientRepo(createEncounter));
    await screen.findByText('Glasgow');
    fireEvent.change(screen.getByLabelText('Date de la rencontre'), { target: { value: '2024-06-01' } });
    fireEvent.change(screen.getByLabelText(/statut du dossier/i), { target: { value: 'curated' } });
    fireEvent.change(screen.getByLabelText('Glasgow'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Admission'), { target: { value: '2024-01-10' } });
    fireEvent.change(screen.getByLabelText('Sortie'), { target: { value: '2024-01-05' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    expect(await screen.findByText('sortie >= admission')).toBeInTheDocument();
    expect(createEncounter).not.toHaveBeenCalled();
  });
});
