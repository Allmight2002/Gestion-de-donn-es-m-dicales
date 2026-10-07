// @vitest-environment jsdom
// L74b — une variable permanente masque une variable de groupe : l'enregistrement de la fiche
// annonce les valeurs d'occurrences effacées, précise que rétablir le pilote ne restaure rien, et
// déclare les effacements au serveur dans la même déclaration que les retraits de bloc (L72e).
// Données fictives uniquement.
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
import { pendingContextErasures, pendingGroupWithdrawals } from '../../domain/groupWithdrawal';

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

// `trauma` (fiche) pilote `ao` dans le groupe racine `lesions`, et le bloc `bloc_t` qui porte le
// groupe enfant `suivis` ; dans l'occurrence, `ao` = C fait apparaître `ao_detail` (cascade).
const sections: TemplateSection[] = [
  { id: 's-l', sectionKey: 'lesions', label: 'Lésions', displayOrder: 0, parentSectionKey: null, isRepeatable: true },
  { id: 's-b', sectionKey: 'bloc_t', label: 'Traumatisme', displayOrder: 1, parentSectionKey: null },
  { id: 's-s', sectionKey: 'suivis', label: 'Suivis', displayOrder: 2, parentSectionKey: 'bloc_t', isRepeatable: true },
];
const patientFields = [
  field({ fieldKey: 'trauma', label: 'Trauma', scope: 'patient' }),
  field({ fieldKey: 'cote_patient', label: 'Côté fiche', scope: 'patient', displayOrder: 1 }),
];
const groupFields = [
  field({ fieldKey: 'ao', label: 'Gradation AO', scope: 'encounter', section: 'lesions', displayOrder: 2 }),
  field({ fieldKey: 'ao_detail', label: 'Détail AO', scope: 'encounter', section: 'lesions', displayOrder: 3 }),
  field({ fieldKey: 'note', label: 'Note', scope: 'encounter', section: 'lesions', displayOrder: 4 }),
  field({ fieldKey: 'suivi_note', label: 'Suivi', scope: 'encounter', section: 'suivis', displayOrder: 5 }),
];
const fields = [...patientFields, ...groupFields];
const rule = (id: string, r: unknown) => ({ id, message: null, severity: 'block' as const, rule: r });
const rules = [
  rule('r-ao', { if: { field: 'trauma', operator: 'equals', value: 'oui' }, then: { field: 'ao', operator: 'visible' } }),
  rule('r-d', { if: { field: 'ao', operator: 'equals', value: 'C' }, then: { field: 'ao_detail', operator: 'visible' } }),
];
const withBlock = [...rules,
  rule('r-b', { if: { field: 'trauma', operator: 'equals', value: 'oui' }, then: { section: 'bloc_t', operator: 'visible' } })];

const occurrence = (id: string, group: string, recordRevision: number | undefined, data: Record<string, unknown>): Encounter => ({
  id, encounterType: 'autre', encounterDate: null, validationStatus: 'draft', ageValue: null, ageUnit: null,
  data, updatedAt: '2026-10-07T11:00:00.000Z', templateVersionId: 'v1', groupSectionKey: group, recordRevision,
});
const lesions = () => [
  occurrence('o2', 'lesions', 7, { ao: 'C', ao_detail: 'détail-fictif' }),
  occurrence('o1', 'lesions', 4, { ao: 'fictif-A', note: 'n' }),
  occurrence('o3', 'lesions', 2, { note: 'n' }),
];

describe('pendingContextErasures — miroir du calcul serveur', () => {
  test('variables renseignées qui deviennent masquées, cascade comprise ; une ligne par groupe et variable', () => {
    const result = pendingContextErasures(sections, rules, fields, { trauma: 'oui' }, { trauma: 'non' }, lesions());
    expect(result.declaration).toEqual([{ sectionKey: 'lesions', clearedFields: [
      { id: 'o1', recordRevision: 4, fieldKeys: ['ao'] },
      { id: 'o2', recordRevision: 7, fieldKeys: ['ao', 'ao_detail'] },
    ] }]);
    expect(result.erasures).toEqual([
      { sectionKey: 'lesions', groupLabel: 'Lésions', fieldKey: 'ao', fieldLabel: 'Gradation AO', count: 2 },
      { sectionKey: 'lesions', groupLabel: 'Lésions', fieldKey: 'ao_detail', fieldLabel: 'Détail AO', count: 1 },
    ]);
    expect(result.declarable).toBe(true);
  });

  test('pilote vidé = condition non vérifiable = masqué ; rien ne change = rien à effacer', () => {
    expect(pendingContextErasures(sections, rules, fields, { trauma: 'oui' }, {}, lesions()).declaration)
      .toHaveLength(1);
    expect(pendingContextErasures(sections, rules, fields, { trauma: 'oui' }, { trauma: 'oui', cote_patient: 'g' },
      lesions()).declaration).toEqual([]);
  });

  test('une valeur déjà masquée au chargement n\'est pas comptée', () => {
    const rows = [occurrence('o1', 'lesions', 4, { ao: 'fictif-A' })];
    expect(pendingContextErasures(sections, rules, fields, { trauma: 'non' }, { trauma: 'autre' }, rows).erasures)
      .toEqual([]);
  });

  test('sans révision serveur, la déclaration n\'est pas utilisable', () => {
    const rows = [occurrence('o1', 'lesions', undefined, { ao: 'fictif-A' })];
    const result = pendingGroupWithdrawals(sections, rules, patientFields, { trauma: 'oui' }, { trauma: 'non' }, rows,
      groupFields);
    expect(result.erasures).toHaveLength(1);
    expect(result.declaration).toBeNull();
  });

  test('retrait de bloc et effacement dans la même déclaration ; le groupe retiré n\'est pas effacé', () => {
    const rows = [...lesions(), occurrence('o9', 'suivis', 3, { suivi_note: 's' })];
    const result = pendingGroupWithdrawals(sections, withBlock, patientFields, { trauma: 'oui' }, { trauma: 'non' }, rows,
      groupFields);
    expect(result.withdrawals.map((w) => w.sectionKey)).toEqual(['suivis']);
    expect(result.erasures.map((e) => e.sectionKey)).toEqual(['lesions', 'lesions']);
    expect(result.declaration).toEqual([
      { sectionKey: 'lesions', clearedFields: [
        { id: 'o1', recordRevision: 4, fieldKeys: ['ao'] },
        { id: 'o2', recordRevision: 7, fieldKeys: ['ao', 'ao_detail'] },
      ] },
      { sectionKey: 'suivis', occurrences: [{ id: 'o9', recordRevision: 3 }] },
    ]);
  });

  test('sans variable de groupe ni règle de contexte, le résultat L72e est inchangé', () => {
    const result = pendingGroupWithdrawals(sections, withBlock.slice(2), patientFields, { trauma: 'oui' },
      { trauma: 'non' }, lesions());
    expect(result.erasures).toEqual([]);
    expect(result.declaration).toBeNull();
  });
});

function renderEdit(updatePatientData: PatientRepository['updatePatientData']) {
  const patient: PatientListItem = {
    id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: { trauma: 'oui' },
    validationStatus: 'draft', version: 3, updatedAt: '2026-10-07T10:00:00.000Z', identity: null,
  };
  const patients = {
    async getPatient() { return patient; },
    async listEncounters() { return lesions(); },
    async listFieldChanges() { return []; },
    updatePatientData,
  } as unknown as PatientRepository;
  const templates = {
    async getVersion() {
      return { version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const }, fields, rules, sections };
    },
  } as unknown as TemplateRepository;
  return render(
    <I18nProvider>
      <RepositoryProvider
        bases={{ async getBase() { return listing; } } as unknown as BaseRepository}
        templates={templates}
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

describe('L74b — confirmation et enregistrement de l\'effacement', () => {
  test('la confirmation annonce les valeurs perdues et l\'absence de restauration, puis les déclare', async () => {
    const user = userEvent.setup();
    const updatePatientData = vi.fn(async () => ({ version: 4, updatedAt: null }));
    renderEdit(updatePatientData);

    const input = await screen.findByRole('textbox', { name: /^Trauma/ });
    await user.clear(input);
    await user.type(input, 'non');
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Lésions : 2 occurrence(s) perdront « Gradation AO »')).toBeInTheDocument();
    expect(within(dialog).getByText('Lésions : 1 occurrence(s) perdront « Détail AO »')).toBeInTheDocument();
    expect(within(dialog).getByText(/rétablir la variable de la fiche ne restaure rien/)).toBeInTheDocument();
    // Aucune valeur clinique d'occurrence dans l'annonce.
    expect(dialog.textContent).not.toMatch(/fictif-A|détail-fictif/);
    expect(updatePatientData).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmer le retrait et enregistrer' }));
    await waitFor(() => expect(updatePatientData).toHaveBeenCalledTimes(1));
    expect(updatePatientData).toHaveBeenCalledWith('p1', { trauma: 'non' }, 'draft', '', 3, [
      { sectionKey: 'lesions', clearedFields: [
        { id: 'o1', recordRevision: 4, fieldKeys: ['ao'] },
        { id: 'o2', recordRevision: 7, fieldKeys: ['ao', 'ao_detail'] },
      ] },
    ]);
  });

  test('occurrence bloquée par le serveur : message dédié, saisies conservées', async () => {
    const user = userEvent.setup();
    const updatePatientData = vi.fn(async () => {
      throw { message: 'GROUP_WITHDRAWAL_OCCURRENCE_BLOCKED', code: 'P0001',
        details: JSON.stringify({ code: 'GROUP_WITHDRAWAL_OCCURRENCE_BLOCKED', action: 'reject',
          sectionKey: 'lesions', id: 'o1' }) };
    });
    renderEdit(updatePatientData);
    const input = await screen.findByRole('textbox', { name: /^Trauma/ });
    await user.clear(input);
    await user.type(input, 'non');
    await user.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmer le retrait et enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Une occurrence ne peut pas perdre la valeur que cette fiche masque/);
    expect(screen.getByRole('textbox', { name: /^Trauma/ })).toHaveValue('non');
  });
});
