import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { BaseRepository } from '../../data/bases';
import type { PatientRepository } from '../../data/patients';
import type { TemplateRepository } from '../../data/templates';
import { WorkDraftError, type WorkDraft, type WorkDraftRepository } from '../../data/workDrafts';
import { I18nProvider } from '../../i18n/I18nProvider';
import { NewPatient } from './NewPatient';
import { EditEncounter } from './EditEncounter';

vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ profile: { id: 'u', globalRole: 'medecin', language: 'fr' }, user: { id: 'u' } }) }));
const field = { id: 'f1', fieldKey: 'score', label: 'Score', section: null, type: 'integer' as const, unit: null, allowedValues: null,
  required: false, minValue: 0, maxValue: 20, allowMissingCodes: false, displayOrder: 0 };
const bases = { async getBase() { return { base: { id: 'b1', currentTemplateVersionId: 'v1' }, role: 'owner', permissions: { canViewIdentity: true } }; } } as unknown as BaseRepository;
const templates = { async getVersion() { return { version: { id: 'v1' }, fields: [{ ...field, scope: 'patient' }, { ...field, scope: 'encounter' }], rules: [] }; } } as unknown as TemplateRepository;
function drafts() {
  return { available: true, list: vi.fn(async () => [] as WorkDraft[]),
    save: vi.fn(async (...args: Parameters<WorkDraftRepository['save']>) => ({ id: args[1], revision: args[2] + 1,
      updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() })),
    commit: vi.fn<WorkDraftRepository['commit']>(async () => ({ id: 'p1' })), discard: vi.fn(async () => undefined) } satisfies WorkDraftRepository;
}
function setup(work: WorkDraftRepository, edit = false) {
  const patients = { listPatientsPage: vi.fn(async () => ({ total: 0, items: [] })), findIdentityMatches: vi.fn(async () => []),
    createPatient: vi.fn(async () => ({ id: 'wrong-path' })), updateEncounter: vi.fn(), listFieldChanges: vi.fn(async () => []),
    getEncounter: vi.fn(async () => ({ id: 'e1', templateVersionId: 'v1', encounterType: 'consultation', validationStatus: 'curated', data: { score: 2 }, updatedAt: '2026-09-11T00:00:00Z' })) };
  render(<I18nProvider><RepositoryProvider workDrafts={work} bases={bases} templates={templates} patients={patients as unknown as PatientRepository}>
    <MemoryRouter initialEntries={[edit ? '/bases/b1/patients/p1/encounters/e1/edit' : '/bases/b1/patients/new']}>
      <Routes><Route path="/bases/:id/patients/new" element={<NewPatient />} />
        <Route path="/bases/:id/patients/:patientId/encounters/:encounterId/edit" element={<EditEncounter />} />
        <Route path="/bases/:id/patients/:patientId" element={<p>Fiche confirmée</p>} />
      </Routes>
    </MemoryRouter>
  </RepositoryProvider></I18nProvider>);
  return patients;
}
describe('clinical form server draft integration', () => {
  test('autosaves analytical values, preserves identity after failure, and recovers a lost commit with the same key', async () => {
    const repo = drafts(); const patients = setup(repo);
    await screen.findByLabelText('Score'); await waitFor(() => expect(repo.list).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Score'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Nom complet'), { target: { value: 'Personne Fictive' } });
    await waitFor(() => expect(repo.save).toHaveBeenCalled(), { timeout: 3000 });
    const saved = repo.save.mock.calls.at(-1)!;
    expect(saved[4]).toEqual({ values: { score: 8 }, code: 'P-0001' });
    expect(JSON.stringify(saved)).not.toContain('Personne Fictive');
    repo.commit.mockRejectedValueOnce(new WorkDraftError('DRAFT_UNAVAILABLE'));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));
    await screen.findByText(/saisie momentanément verrouillée/);
    expect(screen.getByLabelText('Nom complet')).toHaveValue('Personne Fictive');
    expect(screen.getByLabelText('Score')).toHaveValue(8);
    expect(screen.getByLabelText('Score')).toBeDisabled();
    expect(patients.createPatient).not.toHaveBeenCalled();
    const first = repo.commit.mock.calls[0];
    expect(first[3]?.fullName).toBe('Personne Fictive');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));
    expect(await screen.findByText('Fiche confirmée')).toBeInTheDocument();
    expect(repo.commit.mock.calls[1]).toEqual(first);
  });

  test('correction keeps the historical revision and local answers through a network transition and a conflict', async () => {
    const repo = drafts(); const patients = setup(repo, true);
    expect(await screen.findByLabelText('Score')).toHaveValue(2);
    fireEvent.change(screen.getByLabelText('Score'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText(/Motif/), { target: { value: 'Correction fictive' } });
    act(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    expect(screen.getByLabelText('Score')).toHaveValue(11);
    expect(patients.getEncounter).toHaveBeenCalledOnce();
    expect(within(screen.getByLabelText(/statut du dossier/i)).getByRole('option', { name: /Brouillon/ })).toBeDisabled();
    repo.commit.mockRejectedValueOnce(new WorkDraftError('DRAFT_CONTEXT_CHANGED'));
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    await waitFor(() => expect(repo.commit).toHaveBeenCalled());
    expect(repo.save.mock.calls[0][0]).toMatchObject({ kind: 'encounter_update', targetId: 'e1', entityRevision: String(Date.parse('2026-09-11T00:00:00Z')) });
    expect(screen.getByLabelText('Score')).toHaveValue(11);
    expect(screen.getByLabelText(/Motif/)).toHaveValue('Correction fictive');
    expect(patients.updateEncounter).not.toHaveBeenCalled();
  });

  test('a recovered draft from another template version cannot silently replace current input', async () => {
    const repo = drafts();
    repo.list.mockResolvedValueOnce([{ id: 'd1', revision: 1, state: 'active', updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      context: { baseId: 'b1', kind: 'patient_create', targetId: null, templateVersionId: 'old-version', entityRevision: null }, payload: { values: { score: 19 }, code: 'P-OLD' } }]);
    setup(repo);
    await screen.findByLabelText('Score');
    fireEvent.change(screen.getByLabelText('Score'), { target: { value: '6' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Reprendre' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reprendre le brouillon' }));
    expect(await screen.findByText(/Le modèle|La fiche ou le modèle a changé/)).toBeInTheDocument();
    expect(screen.getByLabelText('Score')).toHaveValue(6);
    expect(repo.save).not.toHaveBeenCalled(); expect(repo.commit).not.toHaveBeenCalled();
  });
});
