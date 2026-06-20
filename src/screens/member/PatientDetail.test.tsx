// @vitest-environment jsdom
// Tests de rendu de l'etape 8 (fiche patient + correction) avec repos INJECTES.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { PatientDetail } from './PatientDetail';
import { EditEncounter } from './EditEncounter';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository, Encounter, PatientListItem, FieldChange } from '../../data/patients';
import type { AttachmentRepository } from '../../data/attachments';
import type { TemplateField } from '../../data/types';

const stubAttachments = { async listAttachments() { return []; }, async addImage() { return { id: '' }; } } as unknown as AttachmentRepository;

const ALL_PERMS = {
  canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true,
  canValidateData: true, canExportData: true, canManageAccess: true,
};
const baseListing: BaseListing = {
  base: { id: 'b1', name: 'Base', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner', permissions: ALL_PERMS, templateName: 'Neuro', versionNumber: 1,
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
        field({ fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', type: 'integer', required: true, minValue: 3, maxValue: 15 }),
      ],
      rules: [],
    };
  },
} as unknown as TemplateRepository;

const patientView: PatientListItem = {
  id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: { sexe: 'M' }, validationStatus: 'verified',
  identity: { fullName: 'Jean Test', dateOfBirth: '1980-01-01', phone: null, address: null, externalIdentifier: null },
};
const encounter: Encounter = { id: 'e1', encounterType: 'consultation', encounterDate: '2024-06-01', validationStatus: 'complete', ageValue: 44, ageUnit: 'years', data: { glasgow_score: 12 } };
const historyRows: FieldChange[] = [{ fieldKey: 'glasgow_score', oldValue: 10, newValue: 12, reason: 'correction saisie', changedAt: '2024-06-02' }];

function makePatients(over: Partial<PatientRepository> = {}): PatientRepository {
  return {
    async listPatients() { return []; },
    async createPatient() { return { id: '', code: '' }; },
    async getPatient() { return patientView; },
    async computeAge() { return 44; },
    async createEncounter() { return { id: 'e1' }; },
    async listEncounters() { return [encounter]; },
    async getEncounter() { return encounter; },
    async updateEncounter() { return { id: 'e1' }; },
    async listFieldChanges() { return historyRows; },
    ...over,
  } as unknown as PatientRepository;
}

function renderAt(path: string, patients: PatientRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={baseRepo} templates={templateRepo} patients={patients} attachments={stubAttachments}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/bases/:id/patients/:patientId" element={<PatientDetail />} />
            <Route path="/bases/:id/patients/:patientId/encounters/:encounterId/edit" element={<EditEncounter />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('PatientDetail (fiche)', () => {
  test('affiche identite (si autorisee), donnees permanentes et rencontres', async () => {
    renderAt('/bases/b1/patients/p1', makePatients());
    expect(await screen.findByText('Jean Test')).toBeInTheDocument(); // identite
    expect(screen.getByText('Glasgow')).toBeInTheDocument(); // libelle champ rencontre
    expect(screen.getByText('12')).toBeInTheDocument(); // valeur de la rencontre
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
  });

  test('supprimer le patient exige un motif puis appelle softDeletePatient', async () => {
    const softDeletePatient = vi.fn(async (_id: string, _reason: string) => {});
    renderAt('/bases/b1/patients/p1', makePatients({ softDeletePatient }));
    await screen.findByText(/Jean Test/);
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer ce patient' }));
    fireEvent.change(screen.getByLabelText('Motif de la suppression'), { target: { value: 'doublon' } });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(softDeletePatient).toHaveBeenCalledWith('p1', 'doublon'));
  });
});

describe('EditEncounter (correction)', () => {
  test('le motif est requis ; avec motif, la correction est enregistree ; historique affiche', async () => {
    const updateEncounter = vi.fn(async (_id: string, _data: Record<string, unknown>, _status: string, _reason: string) => ({ id: 'e1' }));
    renderAt('/bases/b1/patients/p1/encounters/e1/edit', makePatients({ updateEncounter }));

    // Historique des corrections affiche.
    expect(await screen.findByText(/correction saisie/)).toBeInTheDocument();

    // Sans motif -> bloque.
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    expect(screen.getByText(/motif de la correction est requis/i)).toBeInTheDocument();
    expect(updateEncounter).not.toHaveBeenCalled();

    // Avec motif -> enregistre.
    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'erreur de frappe' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    expect(updateEncounter).toHaveBeenCalledTimes(1);
    expect(updateEncounter.mock.calls[0][3]).toBe('erreur de frappe');
  });
});
