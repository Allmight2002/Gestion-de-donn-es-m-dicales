// @vitest-environment jsdom
// Parcours E3 : le contexte serveur pilote la projection historique/active et le patch de
// complément. Le dépôt de brouillons serveur est disponible, mais le chemin E3 doit rester
// prioritaire pour une fiche existante ; le parcours hors-ligne reste couvert par ses tests dédiés.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type {
  PatientRepository,
  PatientListItem,
  Encounter,
  RecordFormContext,
} from '../../data/patients';
import type { TemplateRepository } from '../../data/templates';
import type { TemplateField } from '../../data/types';
import type { WorkDraftRepository } from '../../data/workDrafts';
import { EditPatient } from './EditPatient';
import { EditEncounter } from './EditEncounter';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'u', fullName: 'Médecin fictif', globalRole: 'medecin', language: 'fr' },
    user: { id: 'u', email: null },
  }),
}));

const baseListing: BaseListing = {
  base: { id: 'b1', name: 'Base fictive', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v-new' },
  role: 'owner',
  permissions: {
    canViewIdentity: false, canViewRawDocuments: false, canEditStructuredData: true,
    canExportData: false, canManageAccess: true,
  },
  templateName: 'Formulaire fictif',
  versionNumber: 2,
};

function field(
  fieldKey: string,
  label: string,
  scope: 'patient' | 'encounter',
  type: TemplateField['type'],
  displayOrder: number,
  required = false,
): TemplateField {
  return {
    id: fieldKey,
    fieldKey,
    label,
    section: 'clinique',
    type,
    unit: null,
    allowedValues: null,
    required,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder,
    scope,
  };
}

function definition(versionId: string): Record<string, unknown> {
  return { version: { id: versionId }, fields: [], sections: [], rules: [], diagnosisContext: [] };
}

function context(
  kind: 'patient' | 'encounter',
  recordId: string,
  fields: RecordFormContext['fields'],
  recordRevision: number,
  encounterType: string | null = null,
): RecordFormContext {
  return {
    record_kind: kind,
    record_id: recordId,
    record_revision: recordRevision,
    base_id: 'b1',
    active_revision: 2,
    record_definition_revision: 'v-old',
    historical_definition: definition('v-old'),
    active_definition: definition('v-new'),
    fields,
    values: {},
    current_obligations: [{
      field_key: kind === 'patient' ? 'patient_added' : 'encounter_added',
      label: kind === 'patient' ? 'Ajout patient requis' : 'Ajout rencontre requis',
      definition_revision: 'v-new',
      reason: 'not_defined',
    }],
    completeness: {
      current_missing_field_keys: [kind === 'patient' ? 'patient_added' : 'encounter_added'],
      current_missing_count: 1,
      current_complete: false,
      historical_missing_field_keys: [],
      historical_missing_count: 0,
      historical_complete: true,
    },
    diagnosis_coverage: { diagnostics: [], counts: { covered: 0, common_only: 0, uncovered: 0, unclassified: 0 } },
    validation_status: 'curated',
    encounter_type: encounterType,
    context_fingerprint: `sha256:${'a'.repeat(64)}`,
  };
}

function contextField(
  key: string,
  state: 'defined' | 'not_defined',
  valueState: 'empty' | 'present',
): RecordFormContext['fields'][number] {
  return {
    field_key: key,
    definition_revision: state === 'defined' ? 'v-old' : 'v-new',
    active_definition_revision: 'v-new',
    scope: key.startsWith('patient_') || key === 'historical_patient' ? 'patient' : 'encounter',
    definition_state: state,
    applicability: 'applicable',
    applicability_reason: state === 'defined' ? 'applicable' : 'new_addition',
    value_state: valueState,
    provenance: valueState === 'present' ? {
      origin: 'initial', captured_by: 'u', captured_at: '2026-09-16T10:00:00Z',
      definition_revision: 'v-old', operation_id: null,
    } : null,
    definition: { fieldKey: key },
    active_definition: { fieldKey: key },
  };
}

const templates: TemplateRepository = {
  async getVersion(versionId: string) {
    const patientFields = versionId === 'v-old'
      ? [field('historical_patient', 'Valeur historique patient', 'patient', 'text', 0)]
      : [
        field('historical_patient', 'Valeur historique patient', 'patient', 'text', 0),
        field('patient_added', 'Ajout patient requis', 'patient', 'text', 1, true),
      ];
    const encounterFields = versionId === 'v-old'
      ? [field('historical_encounter', 'Valeur historique rencontre', 'encounter', 'integer', 0)]
      : [
        field('historical_encounter', 'Valeur historique rencontre', 'encounter', 'integer', 0),
        field('encounter_added', 'Ajout rencontre requis', 'encounter', 'integer', 1, true),
      ];
    return {
      version: { id: versionId, templateId: 't1', versionNumber: versionId === 'v-old' ? 1 : 2, status: 'published' as const },
      fields: [...patientFields, ...encounterFields],
      rules: [],
      sections: [],
    };
  },
} as unknown as TemplateRepository;

const bases: BaseRepository = { async getBase() { return baseListing; } } as unknown as BaseRepository;
const serverDrafts: WorkDraftRepository = {
  available: true,
  list: vi.fn(async () => []),
  async save() { throw new Error('not used'); },
  async discard() { throw new Error('not used'); },
  async commit() { throw new Error('not used'); },
};

function renderForm(element: ReactElement, patients: PatientRepository, workDrafts = serverDrafts) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases} templates={templates} patients={patients} workDrafts={workDrafts}>
        <MemoryRouter initialEntries={['/bases/b1/patients/p1/edit']}>
          <Routes>
            <Route path="/bases/:id/patients/:patientId/edit" element={element} />
            <Route path="/bases/b1/patients/p1" element={<p>Fiche patient</p>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

test('EditPatient projette l ajout actif sans inventer une valeur et envoie seulement le complément', async () => {
  const updatePatientCompatible = vi.fn(async () => ({
    recordKind: 'patient' as const, recordId: 'p1', recordRevision: 5, validationStatus: 'curated',
    operationId: 'op-patient', activeRevision: 2, recordDefinitionRevision: 'v-old',
    contextFingerprint: `sha256:${'b'.repeat(64)}`,
  }));
  const patient: PatientListItem = {
    id: 'p1', code: 'P-1', templateVersionId: 'v-old', data: { historical_patient: 'ancien' },
    validationStatus: 'curated', version: 4, identity: null,
  };
  const patients = {
    async getPatient() { return patient; },
    async getPatientFormContext() {
      return context('patient', 'p1', [
        contextField('historical_patient', 'defined', 'present'),
        contextField('patient_added', 'not_defined', 'empty'),
      ], 4);
    },
    updatePatientCompatible,
  } as unknown as PatientRepository;

  renderForm(<EditPatient />, patients);
  const added = await screen.findByLabelText('Ajout patient requis');
  expect(added).toHaveValue('');
  fireEvent.change(added, { target: { value: 'complément explicite' } });
  fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'complétion fictive' } });
  await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

  await waitFor(() => expect(updatePatientCompatible).toHaveBeenCalledTimes(1));
  expect(serverDrafts.list).not.toHaveBeenCalled();
  expect(updatePatientCompatible).toHaveBeenCalledWith(expect.objectContaining({
    baseId: 'b1', patientId: 'p1', expectedRecordRevision: 4, recordDefinitionRevision: 'v-old',
    patch: { patient_added: 'complément explicite' }, validationStatus: 'curated',
  }));
  expect(JSON.stringify(updatePatientCompatible.mock.calls)).not.toContain('identity');
});

test('EditEncounter conserve la valeur historique et utilise le contexte de la rencontre pour son ajout', async () => {
  const updateEncounterCompatible = vi.fn(async () => ({
    recordKind: 'encounter' as const, recordId: 'e1', recordRevision: 7, validationStatus: 'curated',
    operationId: 'op-encounter', activeRevision: 2, recordDefinitionRevision: 'v-old',
    contextFingerprint: `sha256:${'c'.repeat(64)}`,
  }));
  const encounter: Encounter = {
    id: 'e1', encounterType: 'consultation', encounterDate: '2026-09-01', validationStatus: 'curated',
    ageValue: 40, ageUnit: 'years', data: { historical_encounter: 8 }, updatedAt: '2026-09-16T10:00:00Z',
    templateVersionId: 'v-old',
  };
  const patients = {
    async getEncounter() { return encounter; },
    async listFieldChanges() { return []; },
    async getEncounterFormContext() {
      return context('encounter', 'e1', [
        contextField('historical_encounter', 'defined', 'present'),
        contextField('encounter_added', 'not_defined', 'empty'),
      ], 6, 'consultation');
    },
    updateEncounterCompatible,
  } as unknown as PatientRepository;

  render(
    <I18nProvider>
      <RepositoryProvider bases={bases} templates={templates} patients={patients} workDrafts={serverDrafts}>
        <MemoryRouter initialEntries={['/bases/b1/patients/p1/encounters/e1/edit']}>
          <Routes><Route path="/bases/:id/patients/:patientId/encounters/:encounterId/edit" element={<EditEncounter />} /></Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
  const added = await screen.findByLabelText('Ajout rencontre requis');
  expect(added).toHaveValue(null);
  fireEvent.change(added, { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'complétion fictive' } });
  await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

  await waitFor(() => expect(updateEncounterCompatible).toHaveBeenCalledTimes(1));
  expect(serverDrafts.list).not.toHaveBeenCalled();
  expect(updateEncounterCompatible).toHaveBeenCalledWith(expect.objectContaining({
    baseId: 'b1', encounterId: 'e1', expectedRecordRevision: 6, recordDefinitionRevision: 'v-old',
    patch: { encounter_added: 12 }, validationStatus: 'curated',
  }));
});
