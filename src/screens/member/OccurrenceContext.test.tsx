// @vitest-environment jsdom
// L74c — une variable PERMANENTE commande l'affichage d'une variable d'occurrence (§9.2, tests
// 13, 14, 15 et 18). Données fictives uniquement.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
import { EditPatient } from './EditPatient';
import { NewPatient } from './NewPatient';
import { PatientDetail } from './PatientDetail';
import type { BaseListing, BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { Encounter, NewEncounterInput, PatientListItem, PatientRepository } from '../../data/patients';
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

const contextRule: ValidationRule = {
  id: 'r1',
  rule: { if: { field: 'trauma', operator: 'equals', value: true }, then: { field: 'gradation_ao', operator: 'visible' } },
  message: null,
  severity: 'block',
};

function templates(rules: ValidationRule[]): TemplateRepository {
  return {
    async getVersion() {
      return {
        version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
        fields: [
          field({ fieldKey: 'trauma', label: 'Trauma', scope: 'patient', type: 'boolean' }),
          field({ fieldKey: 'niveau', label: 'Niveau', scope: 'encounter', type: 'text', section: 'lesions', displayOrder: 0 }),
          field({ fieldKey: 'gradation_ao', label: 'Gradation AO', scope: 'encounter', type: 'text', section: 'lesions', displayOrder: 1 }),
        ],
        rules,
        sections,
      };
    },
  } as unknown as TemplateRepository;
}

const occurrence = (id: string, data: Record<string, unknown>): Encounter => ({
  id, encounterType: 'autre', encounterDate: null, validationStatus: 'draft',
  ageValue: null, ageUnit: null, data,
  updatedAt: '2026-10-06T11:00:00.000Z', templateVersionId: 'v1', groupSectionKey: 'lesions',
});

function makePatients(patientData: Record<string, unknown>, rows: Encounter[], over: Partial<PatientRepository> = {}): PatientRepository {
  const patient: PatientListItem = {
    id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: patientData,
    validationStatus: 'draft', version: 3, updatedAt: '2026-10-06T10:00:00.000Z', identity: null,
  };
  return {
    async getPatient() { return patient; },
    async listEncounters() { return rows; },
    async listFieldChanges() { return []; },
    async createEncounter() { return { id: 'o9' }; },
    async updateEncounter() { return { id: 'o1' }; },
    async softDeleteEncounter() {},
    ...over,
  } as unknown as PatientRepository;
}

function renderAt(path: string, patients: PatientRepository, rules: ValidationRule[] = [contextRule]) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <RepositoryProvider
          bases={{ async getBase() { return listing; } } as unknown as BaseRepository}
          templates={templates(rules)}
          patients={patients}
          attachments={{ async listAttachments() { return []; } } as unknown as AttachmentRepository}
        >
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/bases/:id/patients/new/manual" element={<NewPatient mode="manual" />} />
              <Route path="/bases/:id/patients/:patientId" element={<PatientDetail />} />
              <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

async function openStep(user: ReturnType<typeof userEvent.setup>, name: string) {
  // Le formulaire d'occurrence porte son propre sommaire : celui de la fiche vient en premier.
  const [contents] = await screen.findAllByRole('navigation', { name: 'Sommaire du formulaire' });
  await user.click(within(contents).getByRole('button', { name }));
}

describe('L74c — contexte patient des occurrences', () => {
  test('§9.2 test 13 et 15 — cocher le pilote fait apparaître colonne et champ sans recharger ; le payload reste l’occurrence seule', async () => {
    const user = userEvent.setup();
    const createEncounter = vi.fn(async (_patientId: string, _input: NewEncounterInput) => ({ id: 'o9' }));
    const getPatient = vi.fn();
    const patients = makePatients({ trauma: false }, [occurrence('o1', { niveau: 'C5' })], { createEncounter });
    const original = patients.getPatient.bind(patients);
    patients.getPatient = (async (...args: Parameters<typeof original>) => { getPatient(); return original(...args); }) as typeof patients.getPatient;
    renderAt('/bases/b1/patients/p1/edit', patients);

    await openStep(user, 'Lésions');
    let table = await screen.findByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).queryByRole('columnheader', { name: 'Gradation AO' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ajouter une occurrence' }));
    expect(screen.queryByLabelText(/Gradation AO/)).not.toBeInTheDocument();

    // Coche « Trauma » sur la fiche, sans l'enregistrer.
    await openStep(user, 'Clinique');
    await user.click(screen.getByRole('checkbox', { name: /Trauma/ }));
    await openStep(user, 'Lésions');

    table = screen.getByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getByRole('columnheader', { name: 'Gradation AO' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Niveau/), 'T3');
    await user.type(screen.getByLabelText(/Gradation AO/), 'B');
    expect(getPatient).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Enregistrer l’occurrence' }));
    expect(createEncounter).toHaveBeenCalledTimes(1);
    const payload = createEncounter.mock.calls[0][1].data;
    expect(payload).toEqual({ niveau: 'T3', gradation_ao: 'B' });
    expect(payload).not.toHaveProperty('trauma');
  });

  test('décocher le pilote masque de nouveau le champ en cours de saisie', async () => {
    const user = userEvent.setup();
    renderAt('/bases/b1/patients/p1/edit', makePatients({ trauma: true }, []));

    await openStep(user, 'Lésions');
    await user.click(await screen.findByRole('button', { name: 'Ajouter une occurrence' }));
    expect(screen.getByLabelText(/Gradation AO/)).toBeInTheDocument();

    await openStep(user, 'Clinique');
    await user.click(screen.getByRole('checkbox', { name: /Trauma/ }));
    await openStep(user, 'Lésions');
    expect(screen.queryByLabelText(/Gradation AO/)).not.toBeInTheDocument();
  });

  test('§9.2 test 18 — un groupe sans règle de contexte s’affiche comme avant', async () => {
    const user = userEvent.setup();
    renderAt('/bases/b1/patients/p1/edit', makePatients({ trauma: false }, [occurrence('o1', { niveau: 'C5' })]), []);

    await openStep(user, 'Lésions');
    const table = await screen.findByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getByRole('columnheader', { name: 'Niveau' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Gradation AO' })).toBeInTheDocument();
  });

  test('la fiche en lecture retire la colonne masquée par le contexte, sauf si une ligne y porte une valeur', async () => {
    const { unmount } = renderAt('/bases/b1/patients/p1', makePatients({ trauma: false }, [occurrence('o1', { niveau: 'C5' })]));
    let table = await screen.findByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).queryByRole('columnheader', { name: 'Gradation AO' })).not.toBeInTheDocument();
    // La colonne retirée n'est pas comptée comme un champ vide à réafficher.
    expect(screen.queryByRole('button', { name: /Afficher les champs vides/ })).not.toBeInTheDocument();
    unmount();

    renderAt('/bases/b1/patients/p1', makePatients({ trauma: false }, [occurrence('o1', { niveau: 'C5', gradation_ao: 'B' })]));
    table = await screen.findByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getByRole('columnheader', { name: 'Gradation AO' })).toBeInTheDocument();
  });

  test('§9.2 test 14 — création : les lignes tamponnées s’évaluent contre la fiche locale, et une ligne devenue incohérente bloque l’envoi', async () => {
    const user = userEvent.setup();
    const createPatient = vi.fn(async () => ({ id: 'p1', code: 'P-0001' }));
    const createEncounter = vi.fn(async (_patientId: string, _input: NewEncounterInput, _key: string) => ({ id: 'o1' }));
    const patients = {
      ...makePatients({}, []),
      async listPatients() { return []; },
      async findIdentityMatches() { return []; },
      async computeAge() { return null; },
      createPatient,
      createEncounter,
    } as unknown as PatientRepository;
    renderAt('/bases/b1/patients/new/manual', patients);

    await openStep(user, 'Clinique');
    await user.click(screen.getByRole('checkbox', { name: /Trauma/ }));
    await openStep(user, 'Lésions');
    await user.click(await screen.findByRole('button', { name: 'Ajouter une occurrence' }));
    await user.type(screen.getByRole('textbox', { name: /Niveau/ }), 'C5');
    await user.type(screen.getByRole('textbox', { name: /Gradation AO/ }), 'B');
    await user.click(screen.getByRole('button', { name: 'Conserver l’occurrence' }));
    const table = screen.getByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getByRole('columnheader', { name: 'Gradation AO' })).toBeInTheDocument();

    // Décocher le pilote rend la ligne incohérente : elle est signalée, l'envoi est refusé.
    await openStep(user, 'Clinique');
    await user.click(screen.getByRole('checkbox', { name: /Trauma/ }));
    await openStep(user, 'Lésions');
    expect(screen.getByText('À revoir : la fiche a changé depuis la saisie de cette ligne.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));
    expect(await screen.findByText(/revoyez les lignes signalées/)).toBeInTheDocument();
    expect(createPatient).not.toHaveBeenCalled();

    // Recoché : même verdict qu'à la saisie, la fiche puis l'occurrence partent, sans clé permanente.
    await openStep(user, 'Clinique');
    await user.click(screen.getByRole('checkbox', { name: /Trauma/ }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));
    await waitFor(() => expect(createEncounter).toHaveBeenCalledTimes(1));
    expect(createPatient).toHaveBeenCalledTimes(1);
    expect(createEncounter.mock.calls[0][1].data).toEqual({ niveau: 'C5', gradation_ao: 'B' });
  });
});
