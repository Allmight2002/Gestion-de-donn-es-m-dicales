// @vitest-environment jsdom
// L72c — groupe répétable déclaré SOUS un bloc : rang dans la grappe du bloc et héritage de sa
// visibilité, sur les trois écrans de la fiche. Données fictives uniquement.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
import { PatientDetail } from './PatientDetail';
import { EditPatient } from './EditPatient';
import { NewPatient } from './NewPatient';
import type { BaseListing, BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { Encounter, NewEncounterInput, PatientListItem, PatientRepository } from '../../data/patients';
import type { AttachmentRepository } from '../../data/attachments';
import type { TemplateField, TemplateSection } from '../../data/types';

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
  templateName: 'Rachis', versionNumber: 1,
};

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'scope'>): TemplateField {
  return {
    id: p.fieldKey, section: null, type: 'text', unit: null, allowedValues: null, required: false,
    minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...p,
  };
}

// Bloc A (trauma) : A1, puis le groupe G1, puis A2. Ordre global déjà normalisé par la base.
const sections: TemplateSection[] = [
  { id: 's-a', sectionKey: 'trauma', label: 'Traumatisme', displayOrder: 0, parentSectionKey: null },
  { id: 's-a1', sectionKey: 'trauma_a1', label: 'Mécanisme', displayOrder: 1, parentSectionKey: 'trauma' },
  { id: 's-g1', sectionKey: 'lesions', label: 'Lésions vertébrales', displayOrder: 2, parentSectionKey: 'trauma', isRepeatable: true },
  { id: 's-a2', sectionKey: 'trauma_a2', label: 'Imagerie', displayOrder: 3, parentSectionKey: 'trauma' },
  { id: 's-b', sectionKey: 'suivi', label: 'Suivi', displayOrder: 4, parentSectionKey: null },
];

const templateRepo = {
  async getVersion() {
    return {
      version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
      fields: [
        field({ fieldKey: 'diag', label: 'Diagnostic', scope: 'patient' }),
        field({ fieldKey: 'a1_meca', label: 'Mécanisme lésionnel', scope: 'patient', section: 'trauma_a1', displayOrder: 1 }),
        field({ fieldKey: 'a2_irm', label: 'IRM', scope: 'patient', section: 'trauma_a2', displayOrder: 2 }),
        field({ fieldKey: 'b_note', label: 'Note de suivi', scope: 'patient', section: 'suivi', displayOrder: 3 }),
        field({ fieldKey: 'niveau', label: 'Niveau', scope: 'encounter', section: 'lesions', displayOrder: 4 }),
      ],
      rules: [{
        id: 'r-trauma', message: null, severity: 'block',
        rule: { if: { field: 'diag', operator: 'equals', value: 'trauma' }, then: { section: 'trauma', operator: 'visible' } },
      }],
      sections,
    };
  },
} as unknown as TemplateRepository;

const occurrence = (id: string, niveau: string): Encounter => ({
  id, encounterType: 'autre', encounterDate: null, validationStatus: 'draft',
  ageValue: null, ageUnit: null, data: { niveau },
  updatedAt: '2026-09-23T11:00:00.000Z', templateVersionId: 'v1', groupSectionKey: 'lesions',
});

function makePatients(diag: string, rows: Encounter[], over: Partial<PatientRepository> = {}): PatientRepository {
  const patient: PatientListItem = {
    id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: { diag },
    validationStatus: 'draft', version: 3, updatedAt: '2026-09-23T10:00:00.000Z', identity: null,
  };
  return {
    async getPatient() { return patient; },
    async listEncounters() { return rows; },
    async listFieldChanges() { return []; },
    async listPatients() { return []; },
    async findIdentityMatches() { return []; },
    async computeAge() { return null; },
    async createPatient() { return { id: 'p1', code: 'P-0001' }; },
    async createEncounter() { return { id: 'o' }; },
    async updateEncounter() { return { id: 'o1' }; },
    async softDeleteEncounter() {},
    ...over,
  } as unknown as PatientRepository;
}

function renderAt(path: string, patients: PatientRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider
        bases={{ async getBase() { return listing; } } as unknown as BaseRepository}
        templates={templateRepo}
        patients={patients}
        attachments={{ async listAttachments() { return []; } } as unknown as AttachmentRepository}
      >
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/bases/:id/patients/new/manual" element={<NewPatient mode="manual" />} />
              <Route path="/bases/:id/patients/:patientId" element={<PatientDetail />} />
              <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

const contentsOf = async () => within(await screen.findByRole('navigation', { name: 'Sommaire du formulaire' }));
const stepNames = async () => (await contentsOf()).getAllByRole('button').map((button) => button.textContent);

describe('L72c — correction de la fiche', () => {
  // Test 13 du cadrage — bloquant.
  test('13 : bloc affiché, le groupe est une étape entre A1 et A2, avec sa propre entrée au sommaire', async () => {
    const user = userEvent.setup();
    renderAt('/bases/b1/patients/p1/edit', makePatients('trauma', [occurrence('o1', 'C5'), occurrence('o2', 'T3')]));

    await screen.findByRole('button', { name: 'Lésions vertébrales' });
    expect(await stepNames()).toEqual(['Tronc commun', 'Mécanisme', 'Lésions vertébrales', 'Imagerie', 'Suivi']);
    await user.click((await contentsOf()).getByRole('button', { name: 'Lésions vertébrales' }));
    const table = await screen.findByRole('table', { name: 'Occurrences de Lésions vertébrales' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Ajouter une occurrence' })).toBeEnabled();
    // Le groupe n'est pas fondu dans les champs du bloc : ses variables ne sont jamais des champs de la fiche.
    expect(screen.queryByRole('textbox', { name: /Niveau/ })).not.toBeInTheDocument();
  });

  test('13 : bloc masqué et aucune occurrence, aucune étape de groupe', async () => {
    renderAt('/bases/b1/patients/p1/edit', makePatients('autre', []));

    await screen.findByRole('button', { name: 'Suivi' });
    expect(await stepNames()).toEqual(['Tronc commun', 'Suivi']);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // D10 — bloc masqué avec deux occurrences : avertissement, et aucune étape de saisie.
  test('D10 : bloc masqué avec deux occurrences, un avertissement chiffré remplace la saisie', async () => {
    const user = userEvent.setup();
    renderAt('/bases/b1/patients/p1/edit', makePatients('autre', [occurrence('o1', 'C5'), occurrence('o2', 'T3')]));

    await user.click(await screen.findByRole('button', { name: 'Lésions vertébrales' }));
    expect(await stepNames()).toEqual(['Tronc commun', 'Lésions vertébrales', 'Suivi']);
    expect(await screen.findByText(/masqué pour cette fiche\. 2 occurrence\(s\) y restent enregistrée\(s\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une occurrence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifier l’occurrence/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Supprimer l’occurrence 1 de Lésions vertébrales' })).toBeInTheDocument();
    // Aucune valeur clinique dans l'avertissement.
    expect(screen.getByText(/masqué pour cette fiche/).textContent).not.toMatch(/C5|T3|autre|trauma/);
  });
});

describe('L72c — lecture de la fiche', () => {
  const legends = () => screen.getAllByRole('group').map((group) => group.querySelector('legend')?.textContent?.trim());

  test('le groupe est lu à son rang dans la grappe du bloc', async () => {
    renderAt('/bases/b1/patients/p1', makePatients('trauma', [occurrence('o1', 'C5')]));

    await screen.findByRole('table', { name: 'Occurrences de Lésions vertébrales' });
    const order = legends().filter((label) => ['Mécanisme', 'Lésions vertébrales', 'Imagerie', 'Suivi'].includes(label ?? ''));
    expect(order).toEqual(['Mécanisme', 'Lésions vertébrales', 'Imagerie', 'Suivi']);
  });

  test('D10 : bloc masqué, le groupe porteur d’occurrences est annoncé en lecture seule', async () => {
    renderAt('/bases/b1/patients/p1', makePatients('autre', [occurrence('o1', 'C5'), occurrence('o2', 'T3')]));

    expect(await screen.findByText('Le bloc de ce groupe est masqué pour cette fiche. 2 occurrence(s) y restent enregistrée(s).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Supprimer l’occurrence/ })).not.toBeInTheDocument();
  });

  test('bloc masqué sans occurrence : aucune trace du groupe', async () => {
    renderAt('/bases/b1/patients/p1', makePatients('autre', []));

    await screen.findByText('Note de suivi');
    expect(screen.queryByText('Lésions vertébrales')).not.toBeInTheDocument();
  });
});

describe('L72c — création de patient avec un groupe enfant (test 17)', () => {
  async function openStep(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click((await contentsOf()).getByRole('button', { name }));
  }
  async function addOccurrence(user: ReturnType<typeof userEvent.setup>, niveau: string) {
    await user.click(screen.getByRole('button', { name: 'Ajouter une occurrence' }));
    await user.type(screen.getByRole('textbox', { name: /Niveau/ }), niveau);
    await user.click(screen.getByRole('button', { name: 'Conserver l’occurrence' }));
  }

  test('occurrences tamponnées, rejeu ordonné, échec partiel repris sans doublon', async () => {
    const user = userEvent.setup();
    let failSecond = true;
    const createEncounter = vi.fn(async (_patientId: string, input: NewEncounterInput, _operationKey: string) => {
      if (failSecond && input.data.niveau === 'T3') throw new Error('Occurrence refusée par la base');
      return { id: `o-${String(input.data.niveau)}` };
    });
    const createPatient = vi.fn(async () => ({ id: 'p1', code: 'P-0001' }));
    renderAt('/bases/b1/patients/new/manual', makePatients('', [], { createEncounter, createPatient }));

    // Tant que le diagnostic n'ouvre pas le bloc, le groupe n'est pas une étape.
    await screen.findByRole('button', { name: 'Tronc commun' });
    expect(await stepNames()).not.toContain('Lésions vertébrales');
    await openStep(user, 'Tronc commun');
    await user.type(screen.getByRole('textbox', { name: /Diagnostic/ }), 'trauma');
    expect(await stepNames()).toEqual(['Identification du patient', 'Tronc commun', 'Mécanisme', 'Lésions vertébrales', 'Imagerie', 'Suivi']);

    await openStep(user, 'Lésions vertébrales');
    await addOccurrence(user, 'C5');
    await addOccurrence(user, 'T3');
    await addOccurrence(user, 'L1');
    expect(createEncounter).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));

    const banner = await screen.findByRole('alert', { name: 'Occurrences non confirmées' });
    expect(banner).toHaveTextContent('1 occurrence(s) sur 3 écrite(s)');
    failSecond = false;
    await user.click(within(banner).getByRole('button', { name: 'Reprendre les lignes restantes' }));

    await waitFor(() => expect(createEncounter).toHaveBeenCalledTimes(4));
    expect(createPatient).toHaveBeenCalledTimes(1);
    expect(createEncounter.mock.calls.map((call) => call[1].data.niveau)).toEqual(['C5', 'T3', 'T3', 'L1']);
    const t3Keys = createEncounter.mock.calls.filter((call) => call[1].data.niveau === 'T3').map((call) => call[2]);
    expect(t3Keys[1]).toBe(t3Keys[0]);
    for (const call of createEncounter.mock.calls) expect(call[1]).toMatchObject({ groupSectionKey: 'lesions' });
  });

  test('D10 : lignes tamponnées dans un groupe dont le bloc se masque, annoncées et retirables', async () => {
    const user = userEvent.setup();
    renderAt('/bases/b1/patients/new/manual', makePatients('', []));

    await openStep(user, 'Tronc commun');
    await user.type(screen.getByRole('textbox', { name: /Diagnostic/ }), 'trauma');
    await openStep(user, 'Lésions vertébrales');
    await addOccurrence(user, 'C5');

    await openStep(user, 'Tronc commun');
    await user.clear(screen.getByRole('textbox', { name: /Diagnostic/ }));
    await user.type(screen.getByRole('textbox', { name: /Diagnostic/ }), 'autre');
    expect(await stepNames()).toEqual(['Identification du patient', 'Tronc commun', 'Lésions vertébrales', 'Suivi']);

    await openStep(user, 'Lésions vertébrales');
    expect(screen.getByText(/masqué par la fiche en cours\. 1 occurrence\(s\) en attente/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une occurrence' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifier l’occurrence/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Supprimer l’occurrence 1 de Lésions vertébrales' }));
    expect(await stepNames()).toEqual(['Identification du patient', 'Tronc commun', 'Suivi']);
  });
});
