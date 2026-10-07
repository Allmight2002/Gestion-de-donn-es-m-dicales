// @vitest-environment jsdom
// L74f — une occurrence qui dépend de modifications NON enregistrées de la fiche s'enregistre en
// une seule action : la fiche d'abord (confirmations comprises), puis l'occurrence. Données
// fictives uniquement.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
import { EditPatient } from './EditPatient';
import type { BaseListing, BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type {
  CompatiblePatientUpdateInput, Encounter, NewEncounterInput, PatientListItem, PatientRepository, RecordFormContext,
} from '../../data/patients';
import type { AttachmentRepository } from '../../data/attachments';
import type { TemplateField, TemplateSection, ValidationRule } from '../../data/types';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'u', fullName: 'M', globalRole: 'medecin', language: 'fr' },
    user: { id: 'u', email: null }, signOut: () => {},
  }),
}));

const listing: BaseListing = {
  base: { id: 'b1', name: 'Base', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner',
  permissions: {
    canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true,
    canExportData: true, canManageAccess: true,
  },
  templateName: 'Neuro', versionNumber: 1,
};

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'type' | 'scope'>): TemplateField {
  return {
    id: p.fieldKey, section: 'clinique', unit: null, allowedValues: null, required: false,
    minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...p,
  };
}

const sections: TemplateSection[] = [
  { id: 's-clinique', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 },
  { id: 's-lesions', sectionKey: 'lesions', label: 'Lésions', displayOrder: 1, isRepeatable: true },
];

const fields = [
  field({ fieldKey: 'trauma', label: 'Trauma', scope: 'patient', type: 'boolean' }),
  field({ fieldKey: 'niveau', label: 'Niveau', scope: 'encounter', type: 'text', section: 'lesions', displayOrder: 0 }),
  field({ fieldKey: 'gradation_ao', label: 'Gradation AO', scope: 'encounter', type: 'text', section: 'lesions', displayOrder: 1 }),
];

const rules: ValidationRule[] = [{
  id: 'r1',
  rule: { if: { field: 'trauma', operator: 'equals', value: true }, then: { field: 'gradation_ao', operator: 'visible' } },
  message: null,
  severity: 'block',
}];

const templates = {
  async getVersion() {
    return { version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const }, fields, rules, sections };
  },
} as unknown as TemplateRepository;

const occurrence = (id: string, data: Record<string, unknown>): Encounter => ({
  id, encounterType: 'autre', encounterDate: null, validationStatus: 'draft',
  ageValue: null, ageUnit: null, data,
  updatedAt: '2026-10-07T11:00:00.000Z', templateVersionId: 'v1', groupSectionKey: 'lesions', recordRevision: 2,
});

/** Dépôt à état : la fiche relue après un enregistrement porte la nouvelle révision. */
function makeRepo(patientData: Record<string, unknown>, rows: Encounter[], over: Partial<PatientRepository> = {}) {
  const state = { data: { ...patientData }, version: 3 };
  const writes: string[] = [];
  const updatePatientData = vi.fn(async (_id: string, data: Record<string, unknown>, ..._rest: unknown[]) => {
    writes.push('patient');
    state.data = { ...data };
    state.version += 1;
    return { version: state.version, updatedAt: null };
  });
  const createEncounter = vi.fn(async (_patientId: string, _input: NewEncounterInput) => {
    writes.push('occurrence');
    return { id: 'o9' };
  });
  const updateEncounter = vi.fn(async () => { writes.push('occurrence'); return { id: 'o1' }; });
  const patients = {
    async getPatient(): Promise<PatientListItem> {
      return {
        id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: state.data,
        validationStatus: 'draft', version: state.version, updatedAt: '2026-10-07T10:00:00.000Z', identity: null,
      };
    },
    async listEncounters() { return rows; },
    async listFieldChanges() { return []; },
    async softDeleteEncounter() {},
    updatePatientData,
    createEncounter,
    updateEncounter,
    ...over,
  } as unknown as PatientRepository;
  return { patients, updatePatientData, createEncounter, updateEncounter, writes };
}

function renderEdit(patients: PatientRepository) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <RepositoryProvider
          bases={{ async getBase() { return listing; } } as unknown as BaseRepository}
          templates={templates}
          patients={patients}
          attachments={{ async listAttachments() { return []; } } as unknown as AttachmentRepository}
        >
          <MemoryRouter initialEntries={['/bases/b1/patients/p1/edit']}>
            <Routes>
              <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
              <Route path="/bases/:id/patients/:patientId" element={<p>Fiche du patient</p>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

async function openStep(user: ReturnType<typeof userEvent.setup>, name: string) {
  const [contents] = await screen.findAllByRole('navigation', { name: 'Sommaire du formulaire' });
  await user.click(within(contents).getByRole('button', { name }));
}

const CHAINED = 'Enregistrer la fiche puis l’occurrence';
const ALONE = 'Enregistrer l’occurrence';

/** Coche « Trauma » sans l'enregistrer, puis saisit une nouvelle lésion qui en dépend. */
async function checkTraumaThenFillLesion(user: ReturnType<typeof userEvent.setup>) {
  await openStep(user, 'Clinique');
  await user.click(screen.getByRole('checkbox', { name: /Trauma/ }));
  await openStep(user, 'Lésions');
  await user.click(await screen.findByRole('button', { name: 'Ajouter une occurrence' }));
  await user.type(screen.getByLabelText(/Niveau/), 'T3');
  await user.type(screen.getByLabelText(/Gradation AO/), 'B');
}

afterEach(() => { vi.restoreAllMocks(); });

describe('L74f — fiche puis occurrence, en une seule action', () => {
  test('chemin heureux : la fiche part d’abord, puis l’occurrence ; l’écran reste ouvert et la fiche est relue', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({ trauma: false }, []);
    renderEdit(repo.patients);

    await checkTraumaThenFillLesion(user);
    expect(screen.getByText(/la fiche sera enregistrée d’abord/)).toBeInTheDocument();
    expect(repo.writes).toEqual([]);
    await user.click(screen.getByRole('button', { name: CHAINED }));

    await waitFor(() => expect(repo.createEncounter).toHaveBeenCalledTimes(1));
    expect(repo.writes).toEqual(['patient', 'occurrence']);
    expect(repo.updatePatientData).toHaveBeenCalledWith('p1', { trauma: true }, 'draft', '', 3);
    expect(repo.createEncounter.mock.calls[0][1].data).toEqual({ niveau: 'T3', gradation_ao: 'B' });
    expect(screen.queryByText('Fiche du patient')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText(/Niveau/)).not.toBeInTheDocument());

    // Fiche relue : le prochain enregistrement part sur la nouvelle révision, sans conflit.
    await openStep(user, 'Clinique');
    expect(screen.getByRole('checkbox', { name: /Trauma/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await waitFor(() => expect(repo.updatePatientData).toHaveBeenCalledTimes(2));
    expect(repo.updatePatientData.mock.calls[1][4]).toBe(4);
  });

  test('confirmation de la fiche annulée : rien n’est écrit ; confirmée : fiche déclarée puis occurrence', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({ trauma: true }, [occurrence('o1', { niveau: 'C5', gradation_ao: 'B' })]);
    renderEdit(repo.patients);

    // Décocher le pilote effacera « Gradation AO » de la lésion existante (L74b).
    await openStep(user, 'Clinique');
    await user.click(screen.getByRole('checkbox', { name: /Trauma/ }));
    await openStep(user, 'Lésions');
    await user.click(await screen.findByRole('button', { name: 'Ajouter une occurrence' }));
    await user.type(screen.getByLabelText(/Niveau/), 'T3');
    await user.click(screen.getByRole('button', { name: CHAINED }));

    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Gradation AO/)).toBeInTheDocument();
    expect(repo.writes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Annuler et conserver la saisie' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(repo.writes).toEqual([]);
    expect(screen.getByLabelText(/Niveau/)).toHaveValue('T3');
    expect(screen.queryByText(/Fiche non enregistrée/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: CHAINED }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer le retrait et enregistrer' }));
    await waitFor(() => expect(repo.createEncounter).toHaveBeenCalledTimes(1));
    expect(repo.writes).toEqual(['patient', 'occurrence']);
    expect(repo.updatePatientData).toHaveBeenCalledWith('p1', { trauma: false }, 'draft', '', 3, [
      { sectionKey: 'lesions', clearedFields: [{ id: 'o1', recordRevision: 2, fieldKeys: ['gradation_ao'] }] },
    ]);
    expect(repo.createEncounter.mock.calls[0][1].data).toEqual({ niveau: 'T3' });
  });

  test('fiche refusée : l’occurrence ne part pas, les deux saisies restent', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({ trauma: false }, [], {
      updatePatientData: vi.fn(async () => { throw new Error('Valeur refusée par le serveur'); }),
    });
    renderEdit(repo.patients);

    await checkTraumaThenFillLesion(user);
    await user.click(screen.getByRole('button', { name: CHAINED }));

    expect(await screen.findByText(/Fiche non enregistrée : l’occurrence n’est pas partie/)).toBeInTheDocument();
    expect(repo.createEncounter).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Gradation AO/)).toHaveValue('B');
    expect(screen.getByRole('button', { name: CHAINED })).toBeEnabled();
    await openStep(user, 'Clinique');
    expect(screen.getByRole('checkbox', { name: /Trauma/ })).toBeChecked();
  });

  test('fiche acceptée, occurrence refusée : message clair, brouillon conservé, renvoi seul', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({ trauma: false }, []);
    repo.createEncounter.mockImplementationOnce(async () => { throw new Error('erreur SQL interne'); });
    renderEdit(repo.patients);

    await checkTraumaThenFillLesion(user);
    await user.click(screen.getByRole('button', { name: CHAINED }));

    expect(await screen.findByText(
      'Fiche enregistrée ; l’occurrence n’a pas pu l’être. Une erreur est survenue. Votre saisie est conservée : vous pouvez l’enregistrer seule.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/erreur SQL interne/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Gradation AO/)).toHaveValue('B');

    // La fiche est à jour : l'occurrence repart seule.
    await user.click(await screen.findByRole('button', { name: ALONE }));
    await waitFor(() => expect(repo.createEncounter).toHaveBeenCalledTimes(2));
    expect(repo.updatePatientData).toHaveBeenCalledTimes(1);
    expect(repo.createEncounter.mock.calls[1][1].data).toEqual({ niveau: 'T3', gradation_ao: 'B' });
  });

  test('conflit de version sur la fiche : rien d’autre n’est écrit, rechargement proposé', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({ trauma: false }, [], {
      updatePatientData: vi.fn(async () => { throw new Error('CONFLIT_VERSION'); }),
    });
    renderEdit(repo.patients);

    await checkTraumaThenFillLesion(user);
    await user.click(screen.getByRole('button', { name: CHAINED }));

    expect(await screen.findByText(/modifie par une autre personne/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recharger les données' })).toBeInTheDocument();
    expect(repo.createEncounter).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Gradation AO/)).toHaveValue('B');
  });

  test('conflit sur l’occurrence corrigée après la fiche : le message dit que la fiche est enregistrée', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({ trauma: false }, [occurrence('o1', { niveau: 'C5' })]);
    repo.updateEncounter.mockImplementationOnce(async () => {
      throw Object.assign(new Error('conflit'), { details: JSON.stringify({ code: 'conflict_version', action: 'refresh_required' }) });
    });
    renderEdit(repo.patients);

    await openStep(user, 'Clinique');
    await user.click(screen.getByRole('checkbox', { name: /Trauma/ }));
    await openStep(user, 'Lésions');
    await user.click(await screen.findByRole('button', { name: 'Modifier l’occurrence 1 de Lésions' }));
    await user.type(screen.getByLabelText(/Gradation AO/), 'B');
    await user.click(screen.getByRole('button', { name: CHAINED }));

    expect(await screen.findByText(/^Fiche enregistrée ; l’occurrence n’a pas pu l’être\. Cette occurrence a été modifiée entre-temps/)).toBeInTheDocument();
    expect(repo.updatePatientData).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Gradation AO/)).toHaveValue('B');
  });

  test('sans dépendance à la fiche non enregistrée : l’occurrence part seule, comme avant', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({ trauma: true }, []);
    renderEdit(repo.patients);

    await openStep(user, 'Lésions');
    await user.click(await screen.findByRole('button', { name: 'Ajouter une occurrence' }));
    await user.type(screen.getByLabelText(/Niveau/), 'T3');
    expect(screen.queryByText(/la fiche sera enregistrée d’abord/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: ALONE }));
    await waitFor(() => expect(repo.createEncounter).toHaveBeenCalledTimes(1));
    expect(repo.updatePatientData).not.toHaveBeenCalled();
  });

  test('hors ligne : rien ne part, le message hors ligne reste explicite', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({ trauma: false }, []);
    renderEdit(repo.patients);

    await checkTraumaThenFillLesion(user);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event('offline')); });

    expect(await screen.findByText(/indisponibles hors ligne/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: CHAINED })).not.toBeInTheDocument();
    expect(repo.writes).toEqual([]);
  });
});

// Le chemin compatible E3 : la fiche relue porte la nouvelle révision et la nouvelle empreinte.
describe('L74f — chemin compatible (contexte E3)', () => {
  function patientContext(revision: number, fingerprint: string, values: Record<string, unknown>): RecordFormContext {
    const item = (key: string): RecordFormContext['fields'][number] => ({
      field_key: key, definition_revision: 'v1', active_definition_revision: 'v1', scope: 'patient',
      definition_state: 'defined', applicability: 'applicable', applicability_reason: 'applicable',
      value_state: 'present', provenance: null, definition: { fieldKey: key }, active_definition: { fieldKey: key },
    } as RecordFormContext['fields'][number]);
    return {
      record_kind: 'patient', record_id: 'p1', record_revision: revision, base_id: 'b1', active_revision: 1,
      record_definition_revision: 'v1',
      historical_definition: { version: { id: 'v1' } }, active_definition: { version: { id: 'v1' } },
      fields: [item('trauma')], values, current_obligations: [],
      completeness: {
        current_missing_field_keys: [], current_missing_count: 0, current_complete: true,
        historical_missing_field_keys: [], historical_missing_count: 0, historical_complete: true,
      },
      diagnosis_coverage: { diagnostics: [], counts: { covered: 0, common_only: 0, uncovered: 0, unclassified: 0 } },
      validation_status: 'draft', encounter_type: null, context_fingerprint: fingerprint,
    } as unknown as RecordFormContext;
  }

  test('après l’enregistrement enchaîné, la fiche suivante part sur la révision et l’empreinte relues', async () => {
    const user = userEvent.setup();
    const repo = makeRepo({ trauma: false }, []);
    let saved = { revision: 7, fingerprint: `sha256:${'a'.repeat(64)}`, values: { trauma: false } as Record<string, unknown> };
    const updatePatientCompatible = vi.fn(async (input: CompatiblePatientUpdateInput) => {
      repo.writes.push('patient');
      saved = { revision: saved.revision + 1, fingerprint: `sha256:${'b'.repeat(64)}`, values: { ...saved.values, ...input.patch } };
      return {
        recordKind: 'patient' as const, recordId: 'p1', recordRevision: saved.revision, validationStatus: 'draft',
        operationId: input.operationId, activeRevision: 1, recordDefinitionRevision: 'v1', contextFingerprint: saved.fingerprint,
      };
    });
    Object.assign(repo.patients, {
      updatePatientCompatible,
      async getPatientFormContext() { return patientContext(saved.revision, saved.fingerprint, saved.values); },
      async getPatient() {
        return {
          id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: saved.values,
          validationStatus: 'draft', version: saved.revision, identity: null,
        };
      },
    });
    renderEdit(repo.patients);

    await checkTraumaThenFillLesion(user);
    await user.click(screen.getByRole('button', { name: CHAINED }));
    await waitFor(() => expect(repo.createEncounter).toHaveBeenCalledTimes(1));
    expect(repo.writes).toEqual(['patient', 'occurrence']);
    expect(updatePatientCompatible.mock.calls[0][0]).toMatchObject({
      patch: { trauma: true }, expectedRecordRevision: 7, contextFingerprint: `sha256:${'a'.repeat(64)}`,
    });

    await openStep(user, 'Clinique');
    await user.click(screen.getByRole('checkbox', { name: /Trauma/ }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await waitFor(() => expect(updatePatientCompatible).toHaveBeenCalledTimes(2));
    expect(updatePatientCompatible.mock.calls[1][0]).toMatchObject({
      patch: { trauma: false }, expectedRecordRevision: 8, contextFingerprint: `sha256:${'b'.repeat(64)}`,
    });
    expect(updatePatientCompatible.mock.calls[1][0].operationId).not.toBe(updatePatientCompatible.mock.calls[0][0].operationId);
  });
});
