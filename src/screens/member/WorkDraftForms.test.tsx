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
    commit: vi.fn<WorkDraftRepository['commit']>(async () => ({ id: 'p1' })), discard: vi.fn<WorkDraftRepository['discard']>(async () => undefined) } satisfies WorkDraftRepository;
}
const previousDraft = (id = 'd1'): WorkDraft => ({ id, revision: 1, state: 'active',
  updatedAt: '2026-09-13T10:00:00Z', expiresAt: '2026-09-20T10:00:00Z',
  context: { baseId: 'b1', kind: 'patient_create', targetId: null, templateVersionId: 'v1', entityRevision: null },
  payload: { values: { score: 19 }, code: 'P-OLD' } });
function setup(work: WorkDraftRepository, edit = false) {
  const patients = { listPatientsPage: vi.fn(async () => ({ total: 0, items: [] })), findIdentityMatches: vi.fn(async () => []),
    createPatient: vi.fn(async () => ({ id: 'wrong-path' })), updateEncounter: vi.fn(), listFieldChanges: vi.fn(async () => []),
    getEncounter: vi.fn(async () => ({ id: 'e1', templateVersionId: 'v1', encounterType: 'consultation', validationStatus: 'curated', data: { score: 2 }, updatedAt: '2026-09-11T00:00:00Z' })) };
  render(<I18nProvider><RepositoryProvider workDrafts={work} bases={bases} templates={templates} patients={patients as unknown as PatientRepository}>
    <MemoryRouter initialEntries={[edit ? '/bases/b1/patients/p1/encounters/e1/edit' : '/bases/b1/patients/new']}>
      <Routes><Route path="/bases/:id/patients/new" element={<NewPatient />} />
        <Route path="/bases/:id" element={<p>Accueil de la base</p>} />
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
    expect(screen.getByLabelText('Un bloc à la fois')).toBeChecked();
    expect(screen.getByLabelText('Nom complet')).toBeVisible();
    expect(screen.getByLabelText('Score')).not.toBeVisible();
    fireEvent.change(screen.getByLabelText('Nom complet'), { target: { value: 'Personne Fictive' } });
    await userEvent.click(screen.getByRole('button', { name: 'Bloc suivant' }));
    fireEvent.change(screen.getByLabelText('Score'), { target: { value: '8' } });
    await waitFor(() => expect(repo.save.mock.calls.at(-1)?.[4]).toEqual({ values: { score: 8 }, code: '' }), { timeout: 3000 });
    const saved = repo.save.mock.calls.at(-1)!;
    expect(saved[4]).toEqual({ values: { score: 8 }, code: '' });
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
    expect(await screen.findByRole('dialog', { name: 'Reprendre une saisie précédente ?' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Reprendre' }));
    expect(await screen.findByText(/Le modèle|La fiche ou le modèle a changé/)).toBeInTheDocument();
    expect(screen.getByLabelText('Score')).toHaveValue(null);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(repo.save).not.toHaveBeenCalled(); expect(repo.commit).not.toHaveBeenCalled();
  });
  test('offers the previous entry immediately and resumes only its analytical payload', async () => {
    const repo = drafts(); repo.list.mockResolvedValueOnce([previousDraft()]); setup(repo);
    const dialog = await screen.findByRole('dialog', { name: 'Reprendre une saisie précédente ?' });
    expect(screen.getByLabelText('Nom complet')).toBeDisabled();
    expect(repo.save).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reprendre' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Score')).toHaveValue(19);
    expect(screen.getByText(/attribué automatiquement par le serveur/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('P-OLD')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nom complet')).toHaveValue('');
    expect(repo.discard).not.toHaveBeenCalled();
  });
  test('starts a blank entry only after deletion is acknowledged and retries an uncertain deletion with the same key', async () => {
    const repo = drafts(); repo.list.mockResolvedValueOnce([previousDraft()]);
    repo.discard.mockRejectedValueOnce(new WorkDraftError('DRAFT_UNAVAILABLE'));
    setup(repo);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer et recommencer' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom complet')).toBeDisabled();
    expect(repo.save).not.toHaveBeenCalled();
    const attempt = repo.discard.mock.calls[0];
    let acknowledge!: () => void;
    repo.discard.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer et recommencer' }));
    expect(repo.discard.mock.calls[1]).toEqual(attempt);
    expect(screen.getByRole('button', { name: 'Reprendre' })).toBeDisabled();
    expect(repo.save).not.toHaveBeenCalled();
    await act(async () => acknowledge());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Nom complet')).toHaveValue('');
    expect(screen.getByLabelText('Nom complet')).toBeEnabled();
    expect(screen.getByLabelText('Score')).toHaveValue(null);
    expect(screen.getByText(/attribué automatiquement par le serveur/i)).toBeInTheDocument();
    expect(repo.commit).not.toHaveBeenCalled();
    expect(screen.queryByText('Modifications non sauvegardées')).not.toBeInTheDocument();
  });
  test('cancel keeps the previous draft and leaves the new-patient page', async () => {
    const repo = drafts(); repo.list.mockResolvedValueOnce([previousDraft()]); setup(repo);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revenir à la base' }));
    expect(await screen.findByText('Accueil de la base')).toBeInTheDocument();
    expect(repo.discard).not.toHaveBeenCalled(); expect(repo.save).not.toHaveBeenCalled();
  });
  // « Commencer une nouvelle saisie » ne laisse aucune saisie derriere elle : en garder une
  // la ferait reapparaitre a la visite suivante, alors que l'utilisateur vient de l'abandonner.
  test('with several previous entries, starting a new one deletes them all', async () => {
    const repo = drafts(); repo.list.mockResolvedValueOnce([previousDraft(), previousDraft('d2')]); setup(repo);
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Saisie à reprendre'), 'd2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer et recommencer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(repo.discard).toHaveBeenCalledTimes(2);
    expect(repo.discard).toHaveBeenCalledWith('d1', 1, expect.any(String));
    expect(repo.discard).toHaveBeenCalledWith('d2', 1, expect.any(String));
    expect(screen.getByLabelText('Score')).toHaveValue(null);
  });
  test('does not offer or delete drafts from another form, base or a completed creation', async () => {
    const repo = drafts();
    const other = previousDraft();
    repo.list.mockResolvedValueOnce([
      { ...other, id: 'other-base', context: { ...other.context, baseId: 'b2' } },
      { ...other, id: 'other-form', context: { ...other.context, kind: 'encounter_create', targetId: 'p2' } },
      { ...other, id: 'consumed', state: 'consumed' },
    ]);
    setup(repo); await screen.findByLabelText('Nom complet');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(repo.discard).not.toHaveBeenCalled();
  });
});
