// @vitest-environment jsdom
// L72e — retrait d'un bloc qui porte un groupe répétable : la confirmation annonce, par bloc, les
// occurrences supprimées sans retour possible (D6), l'enregistrement les déclare au serveur, et un
// conflit conserve les saisies en proposant un rechargement. Données fictives uniquement.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
import { EditPatient } from './EditPatient';
import type { BaseListing, BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { Encounter, PatientListItem, PatientRepository } from '../../data/patients';
import type { AttachmentRepository } from '../../data/attachments';
import type { TemplateField, TemplateSection } from '../../data/types';
import { pendingGroupWithdrawals } from '../../domain/groupWithdrawal';

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

// `diag` pilote `trauma` (groupe `lesions`) ; `stade`, dans `pilote`, pilote `suite` (groupe
// `suivis`) : une cascade de deux règles.
const sections: TemplateSection[] = [
  { id: 's-a', sectionKey: 'trauma', label: 'Traumatisme', displayOrder: 0, parentSectionKey: null },
  { id: 's-g1', sectionKey: 'lesions', label: 'Lésions vertébrales', displayOrder: 1, parentSectionKey: 'trauma', isRepeatable: true },
  { id: 's-p', sectionKey: 'pilote', label: 'Stadification', displayOrder: 2, parentSectionKey: null },
  { id: 's-s', sectionKey: 'suite', label: 'Suite', displayOrder: 3, parentSectionKey: null },
  { id: 's-g2', sectionKey: 'suivis', label: 'Suivis', displayOrder: 4, parentSectionKey: 'suite', isRepeatable: true },
];
const fields = [
  field({ fieldKey: 'diag', label: 'Diagnostic', scope: 'patient' }),
  field({ fieldKey: 'a_type', label: 'Type', scope: 'patient', section: 'trauma', displayOrder: 1 }),
  field({ fieldKey: 'stade', label: 'Stade', scope: 'patient', section: 'pilote', displayOrder: 2 }),
  field({ fieldKey: 'niveau', label: 'Niveau', scope: 'encounter', section: 'lesions', displayOrder: 3 }),
  field({ fieldKey: 'suivi_note', label: 'Note', scope: 'encounter', section: 'suivis', displayOrder: 4 }),
];
const rules = [
  { id: 'r-a', message: null, severity: 'block' as const,
    rule: { if: { field: 'diag', operator: 'equals', value: 'trauma' }, then: { section: 'trauma', operator: 'visible' } } },
  { id: 'r-p', message: null, severity: 'block' as const,
    rule: { if: { field: 'diag', operator: 'equals', value: 'trauma' }, then: { section: 'pilote', operator: 'visible' } } },
  { id: 'r-s', message: null, severity: 'block' as const,
    rule: { if: { field: 'stade', operator: 'equals', value: 'avancé' }, then: { section: 'suite', operator: 'visible' } } },
];

const templateRepo = {
  async getVersion() {
    return { version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const }, fields, rules, sections };
  },
} as unknown as TemplateRepository;

const occurrence = (id: string, group: string, recordRevision: number): Encounter => ({
  id, encounterType: 'autre', encounterDate: null, validationStatus: 'draft', ageValue: null, ageUnit: null,
  data: { niveau: 'C5' }, updatedAt: '2026-09-23T11:00:00.000Z', templateVersionId: 'v1', groupSectionKey: group,
  recordRevision,
});

function renderEdit(updatePatientData: PatientRepository['updatePatientData']) {
  const patient: PatientListItem = {
    id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: { diag: 'trauma', stade: 'avancé' },
    validationStatus: 'draft', version: 3, updatedAt: '2026-09-23T10:00:00.000Z', identity: null,
  };
  const patients = {
    async getPatient() { return patient; },
    async listEncounters() {
      return [occurrence('o2', 'lesions', 7), occurrence('o1', 'lesions', 4), occurrence('o3', 'suivis', 2)];
    },
    async listFieldChanges() { return []; },
    updatePatientData,
  } as unknown as PatientRepository;
  return render(
    <I18nProvider>
      <RepositoryProvider
        bases={{ async getBase() { return listing; } } as unknown as BaseRepository}
        templates={templateRepo}
        patients={patients}
        attachments={{ async listAttachments() { return []; } } as unknown as AttachmentRepository}
      >
        <ToastProvider>
          <MemoryRouter initialEntries={['/bases/b1/patients/p1/edit']}>
            <Routes>
              <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
              <Route path="/bases/:id/patients/:patientId" element={<p>Fiche</p>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

async function withdrawDiagnosis(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByRole('textbox', { name: /Diagnostic/ });
  await user.clear(input);
  await user.type(input, 'autre');
  await user.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
  return screen.findByRole('dialog');
}

describe('pendingGroupWithdrawals', () => {
  test('cascade comprise ; un groupe déjà masqué ou sans occurrence n\'est pas compté', () => {
    const rows = [occurrence('o2', 'lesions', 7), occurrence('o1', 'lesions', 4), occurrence('o3', 'suivis', 2)];
    const result = pendingGroupWithdrawals(sections, rules, fields,
      { diag: 'trauma', stade: 'avancé' }, { diag: 'autre', stade: 'avancé' }, rows);
    expect(result.withdrawals).toEqual([
      { sectionKey: 'lesions', blockKey: 'trauma', blockLabel: 'Traumatisme', count: 2 },
      { sectionKey: 'suivis', blockKey: 'suite', blockLabel: 'Suite', count: 1 },
    ]);
    expect(result.declaration).toEqual([
      { sectionKey: 'lesions', occurrences: [{ id: 'o1', recordRevision: 4 }, { id: 'o2', recordRevision: 7 }] },
      { sectionKey: 'suivis', occurrences: [{ id: 'o3', recordRevision: 2 }] },
    ]);
    expect(pendingGroupWithdrawals(sections, rules, fields, { diag: 'autre' }, { diag: 'autre', stade: 'x' }, rows).withdrawals)
      .toEqual([]);
    expect(pendingGroupWithdrawals(sections, rules, fields, { diag: 'trauma' }, {}, []).withdrawals).toEqual([]);
  });

  test('sans révision serveur, aucune déclaration n\'est inventée', () => {
    const rows = [{ ...occurrence('o1', 'lesions', 1), recordRevision: undefined }];
    const result = pendingGroupWithdrawals(sections, rules, fields, { diag: 'trauma' }, { diag: 'autre' }, rows);
    expect(result.withdrawals).toHaveLength(1);
    expect(result.declaration).toBeNull();
  });
});

describe('L72e — confirmation et enregistrement du retrait', () => {
  test('la confirmation annonce le nombre par bloc et l\'absence de restauration, puis déclare les occurrences', async () => {
    const user = userEvent.setup();
    const updatePatientData = vi.fn(async () => ({ version: 4, updatedAt: null }));
    renderEdit(updatePatientData);

    const dialog = await withdrawDiagnosis(user);
    expect(within(dialog).getByText('Traumatisme : 2 occurrence(s) supprimée(s)')).toBeInTheDocument();
    expect(within(dialog).getByText('Suite : 1 occurrence(s) supprimée(s)')).toBeInTheDocument();
    expect(within(dialog).getByText(/ne pourront pas être restaurées depuis l’écran/)).toBeInTheDocument();
    // Aucune valeur clinique d'occurrence dans l'annonce.
    expect(dialog.textContent).not.toMatch(/C5/);
    expect(updatePatientData).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmer le retrait et enregistrer' }));
    await waitFor(() => expect(updatePatientData).toHaveBeenCalledTimes(1));
    expect(updatePatientData).toHaveBeenCalledWith('p1', { diag: 'autre' }, 'draft', '', 3, [
      { sectionKey: 'lesions', occurrences: [{ id: 'o1', recordRevision: 4 }, { id: 'o2', recordRevision: 7 }] },
      { sectionKey: 'suivis', occurrences: [{ id: 'o3', recordRevision: 2 }] },
    ]);
  });

  test('conflit : rien n\'est perdu, un rechargement explicite est proposé', async () => {
    const user = userEvent.setup();
    const updatePatientData = vi.fn(async () => {
      throw { message: 'GROUP_WITHDRAWAL_CONFLICT', code: 'P0001', hint: 'refresh_required',
        details: JSON.stringify({ code: 'GROUP_WITHDRAWAL_CONFLICT', action: 'refresh_required', groups: [] }) };
    });
    renderEdit(updatePatientData);

    const dialog = await withdrawDiagnosis(user);
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer le retrait et enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/occurrences du bloc masqué ont changé/);
    expect(screen.getByRole('button', { name: 'Recharger les données' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Diagnostic/ })).toHaveValue('autre');
  });
});
