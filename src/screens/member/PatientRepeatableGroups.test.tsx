// @vitest-environment jsdom
// L68 — le bloc repetable A SA PLACE dans la fiche existante : rendu dans le formulaire de
// correction, rendu en lecture sur la fiche, et jamais confondu avec une rencontre.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { PatientDetail } from './PatientDetail';
import { EditPatient } from './EditPatient';
import { encounterApplicableFields } from './EncounterFields';
import type { BaseListing, BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { Encounter, PatientListItem, PatientRepository } from '../../data/patients';
import type { AttachmentRepository } from '../../data/attachments';
import type { TemplateField, TemplateSection } from '../../data/types';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'u', fullName: 'M', globalRole: 'medecin', language: 'fr' },
    user: { id: 'u', email: null }, signOut: () => {},
  }),
}));

const baseListing: BaseListing = {
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

const templateRepo = {
  async getVersion() {
    return {
      version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
      fields: [
        field({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'] }),
        field({ fieldKey: 'niveau', label: 'Niveau', scope: 'encounter', type: 'text', section: 'lesions', displayOrder: 0 }),
        field({ fieldKey: 'morphologie', label: 'Morphologie', scope: 'encounter', type: 'text', section: 'lesions', displayOrder: 1 }),
        field({ fieldKey: 'glasgow', label: 'Glasgow', scope: 'encounter', type: 'integer' }),
      ],
      rules: [],
      sections,
    };
  },
} as unknown as TemplateRepository;

const patientView: PatientListItem = {
  id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: { sexe: 'M' },
  validationStatus: 'draft', version: 3, updatedAt: '2026-09-18T10:00:00.000Z', identity: null,
};

const consultation: Encounter = {
  id: 'e1', encounterType: 'consultation', encounterDate: '2026-06-01', validationStatus: 'complete',
  ageValue: 44, ageUnit: 'years', data: { glasgow: 12 }, templateVersionId: 'v1', groupSectionKey: null,
};
const occurrence = (id: string, niveau: string, morphologie: string): Encounter => ({
  id, encounterType: 'autre', encounterDate: null, validationStatus: 'draft',
  ageValue: null, ageUnit: null, data: { niveau, morphologie },
  updatedAt: '2026-09-18T11:00:00.000Z', templateVersionId: 'v1', groupSectionKey: 'lesions',
});

function makePatients(over: Partial<PatientRepository> = {}): PatientRepository {
  return {
    async getPatient() { return patientView; },
    async listEncounters() { return [consultation, occurrence('o1', 'C5', 'A3'), occurrence('o2', 'T3', 'B2')]; },
    async listFieldChanges() { return []; },
    async createEncounter() { return { id: 'o3' }; },
    async updateEncounter() { return { id: 'o1' }; },
    async softDeleteEncounter() {},
    ...over,
  } as unknown as PatientRepository;
}

function renderAt(path: string, patients: PatientRepository = makePatients()) {
  return render(
    <I18nProvider>
      <RepositoryProvider
        bases={{ async getBase() { return baseListing; } } as unknown as BaseRepository}
        templates={templateRepo}
        patients={patients}
        attachments={{ async listAttachments() { return []; } } as unknown as AttachmentRepository}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/bases/:id/patients/:patientId" element={<PatientDetail />} />
            <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('L68 — le groupe repetable dans la fiche existante', () => {
  test('la fiche rend le groupe en lecture et ne compte jamais une occurrence comme une rencontre', async () => {
    renderAt('/bases/b1/patients/p1');

    const table = await screen.findByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getByRole('columnheader', { name: 'Niveau' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Morphologie' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(3); // en-tete + deux occurrences
    expect(within(table).getByText('C5')).toBeInTheDocument();
    expect(within(table).getByText('B2')).toBeInTheDocument();
    expect(screen.getByText('2 occurrence(s)')).toBeInTheDocument();

    // Lecture seule : le tableau est rendu, aucune action d'ecriture ne l'est (§8.4).
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une occurrence' })).not.toBeInTheDocument();

    // La liste des rencontres ne retient que la vraie consultation (§4.2).
    expect(screen.getByText(/Consultation/)).toBeInTheDocument();
    expect(screen.queryByText(/Autre/)).not.toBeInTheDocument();
  });

  test('la correction rend le groupe a sa place dans le formulaire, sans en saisir les variables une a une', async () => {
    const user = userEvent.setup();
    renderAt('/bases/b1/patients/p1/edit');

    // Le bloc repetable est une etape du formulaire, entre les autres blocs.
    const contents = await screen.findByRole('navigation', { name: 'Sommaire du formulaire' });
    expect(within(contents).getByRole('button', { name: 'Clinique' })).toBeInTheDocument();
    const step = within(contents).getByRole('button', { name: 'Lésions' });

    // Tant que l'etape n'est pas ouverte, le bloc reste replie comme n'importe quel autre.
    expect(screen.queryByRole('table', { name: 'Occurrences de Lésions' })).not.toBeInTheDocument();
    await user.click(step);

    const table = await screen.findByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Ajouter une occurrence' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Modifier l’occurrence 2 de Lésions' })).toBeInTheDocument();

    // Les variables du bloc ne sont PAS proposees une a une sur la fiche : elles decrivent une
    // occurrence, et le tableau est leur seule saisie (§8.1).
    expect(screen.queryByRole('textbox', { name: 'Niveau' })).not.toBeInTheDocument();
  });

  // §5, seconde branche — celle qu'on oublie. La retirer du RENDU ne suffit pas : restee
  // applicable, une variable requise de bloc répétable serait exigée sur une consultation
  // ordinaire sans être saisissable nulle part, et la rencontre deviendrait inenregistrable.
  test('une variable de bloc répétable ne s’applique jamais à une rencontre ordinaire', () => {
    const encounterFields = [
      field({ fieldKey: 'glasgow', label: 'Glasgow', scope: 'encounter', type: 'integer' }),
      field({ fieldKey: 'niveau', label: 'Niveau', scope: 'encounter', type: 'text', section: 'lesions', required: true }),
      field({ fieldKey: 'hospit', label: 'Motif', scope: 'encounter', type: 'text', encounterTypes: ['hospitalisation'] }),
    ];

    expect(encounterApplicableFields(encounterFields, sections, 'consultation').map((f) => f.fieldKey))
      .toEqual(['glasgow']);
    // Sans bloc répétable déclaré, la règle est exactement celle d'avant.
    expect(encounterApplicableFields(encounterFields, [sections[0]], 'consultation').map((f) => f.fieldKey))
      .toEqual(['glasgow', 'niveau']);
  });

  test('une lecture d’occurrences en echec ne se lit jamais comme « aucune occurrence »', async () => {
    const user = userEvent.setup();
    renderAt('/bases/b1/patients/p1/edit', makePatients({
      async listEncounters() { throw new Error('lecture refusée'); },
    }));

    await user.click(await screen.findByRole('button', { name: 'Lésions' }));
    expect(screen.queryByText('0 occurrence(s)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une occurrence' })).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('lecture refusée');
  });
});
