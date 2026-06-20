// @vitest-environment jsdom
// Tests de rendu du POOL de curation (cahier v3.0) avec repos INJECTES.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { CurationPool } from './CurationPool';
import { CurationTask } from './CurationTask';
import { CurationBoard } from './CurationBoard';
import type { CurationRepository, TaskBundle, CurationTaskItem } from '../../data/curation';
import type { TemplateRepository } from '../../data/templates';
import type { GlobalRole } from '../../auth/types';

const auth = vi.hoisted(() => ({ role: 'curateur' as GlobalRole, id: 'cur' }));
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ profile: { id: auth.id, fullName: 'X', globalRole: auth.role, language: 'fr' }, user: { id: auth.id, email: null }, signOut: () => {} }),
}));
beforeEach(() => { auth.role = 'curateur'; auth.id = 'cur'; });

const templateRepo = {
  async getVersion() {
    return { version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' as const }, fields: [], rules: [] };
  },
} as unknown as TemplateRepository;

const openTask: CurationTaskItem = {
  id: 'tk1', baseId: 'b1', submissionId: 's1', status: 'open', caseCode: 'CASE-AB12', scope: 'patient',
  templateVersionId: 'v1', assignedTo: null, assignedName: null, targetPatientId: null, targetPatientCode: null, externalRef: null,
};
const bundle = (status: string, taskStatus: string): TaskBundle => ({
  task: { ...openTask, status: taskStatus, assignedTo: 'cur', assignedName: 'Carl' },
  documents: [{ id: 'd1', label: 'CR (deident.)', storagePath: 'b1/s1/cr.pdf', mimeType: 'application/pdf', signedUrl: 'http://x/cr.pdf' }],
  draft: { id: 'dr1', taskId: 'tk1', patientData: {}, encounters: [], status },
  reviews: [],
  patientIdentity: null,
});

function renderAt(path: string, curation: CurationRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider templates={templateRepo} curation={curation}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/curation" element={<CurationPool />} />
            <Route path="/curation/:taskId" element={<CurationTask />} />
            <Route path="/bases/:id/curation" element={<div>SUIVI</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('CurationPool (staff)', () => {
  test('un curateur voit le pool (code opaque) et reserve un cas ouvert', async () => {
    const claimTask = vi.fn(async (_id: string) => {});
    const curation = { async listPool() { return [openTask]; }, claimTask } as unknown as CurationRepository;
    renderAt('/curation', curation);
    expect(await screen.findByText('CASE-AB12')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Réserver' }));
    await waitFor(() => expect(claimTask).toHaveBeenCalledWith('tk1'));
  });

  test('un medecin (non staff) ne voit pas le pool', async () => {
    auth.role = 'medecin';
    const curation = { async listPool() { return []; } } as unknown as CurationRepository;
    renderAt('/curation', curation);
    expect(await screen.findByText(/réservé aux curateurs/i)).toBeInTheDocument();
  });
});

describe('CurationTask (pool)', () => {
  test('un validateur valide un brouillon soumis -> validateDraft(approved)', async () => {
    auth.role = 'validateur'; auth.id = 'val';
    const validateDraft = vi.fn(async (_id: string, _decision: 'approved' | 'rejected', _comment: string | null) => {});
    const curation = { async getTaskBundle() { return bundle('submitted', 'submitted'); }, validateDraft } as unknown as CurationRepository;
    renderAt('/curation/tk1', curation);
    expect(await screen.findByText('CASE-AB12')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(validateDraft).toHaveBeenCalledTimes(1));
    expect(validateDraft.mock.calls[0][1]).toBe('approved');
  });

  test('le curateur affecte soumet le brouillon (enregistre puis soumet)', async () => {
    auth.role = 'curateur'; auth.id = 'cur';
    const saveDraft = vi.fn(async () => {});
    const submitDraft = vi.fn(async () => {});
    const curation = { async getTaskBundle() { return bundle('draft', 'in_progress'); }, saveDraft, submitDraft } as unknown as CurationRepository;
    renderAt('/curation/tk1', curation);
    await userEvent.click(await screen.findByRole('button', { name: 'Soumettre pour validation' }));
    await waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(1));
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });
});

describe('CurationTask (medecin proprietaire : envoi au pool)', () => {
  const ownerBundle = (documents: TaskBundle['documents']): TaskBundle => ({
    task: { ...openTask, status: 'preparing', targetPatientCode: 'P-0001' },
    documents, draft: null, reviews: [],
    patientIdentity: { fullName: 'Marie Test', dateOfBirth: '1990-01-01' },
  });

  test('voit l identite minimale (lecture seule) et soumet la demande au pool', async () => {
    auth.role = 'medecin'; auth.id = 'doc';
    const submitRequest = vi.fn(async () => {});
    const docs = [{ id: 'd1', label: 'CR', storagePath: 'b1/s1/cr.pdf', mimeType: 'application/pdf', signedUrl: null }];
    const curation = { async getTaskBundle() { return ownerBundle(docs); }, submitRequest } as unknown as CurationRepository;
    renderAt('/curation/tk1', curation);
    expect(await screen.findByText('Marie Test')).toBeInTheDocument(); // identite minimale visible
    await userEvent.click(screen.getByRole('button', { name: 'Soumettre la demande au staff' }));
    await waitFor(() => expect(submitRequest).toHaveBeenCalledWith('tk1'));
    expect(await screen.findByText('SUIVI')).toBeInTheDocument(); // redirige vers le Suivi
  });

  test('sans document, le bouton Soumettre est desactive', async () => {
    auth.role = 'medecin'; auth.id = 'doc';
    const curation = { async getTaskBundle() { return ownerBundle([]); } } as unknown as CurationRepository;
    renderAt('/curation/tk1', curation);
    expect(await screen.findByRole('button', { name: 'Soumettre la demande au staff' })).toBeDisabled();
  });
});

describe('CurationBoard (suivi : suppression d une demande)', () => {
  function renderBoard(deleteRequest: CurationRepository['deleteRequest']) {
    let calls = 0;
    const curation = {
      async listBaseSubmissions() { calls += 1; return calls === 1 ? [{ ...openTask, status: 'preparing', targetPatientCode: 'P-0001' }] : []; },
      deleteRequest,
    } as unknown as CurationRepository;
    return render(
      <I18nProvider>
        <RepositoryProvider curation={curation}>
          <MemoryRouter initialEntries={['/bases/b1/curation']}>
            <Routes><Route path="/bases/:id/curation" element={<CurationBoard />} /></Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
  }

  test('supprime LA DEMANDE seulement (apres saisie du motif)', async () => {
    auth.role = 'medecin'; auth.id = 'doc';
    const deleteRequest = vi.fn(async () => {});
    renderBoard(deleteRequest);
    expect(await screen.findByText('CASE-AB12')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la demande' }));
    await userEvent.type(screen.getByLabelText('Motif de la suppression'), 'doublon');
    await userEvent.click(screen.getByRole('button', { name: 'La demande seulement' }));
    await waitFor(() => expect(deleteRequest).toHaveBeenCalledWith('tk1', 'doublon', false));
  });

  test('supprime LE PATIENT + la demande', async () => {
    auth.role = 'medecin'; auth.id = 'doc';
    const deleteRequest = vi.fn(async () => {});
    renderBoard(deleteRequest);
    await screen.findByText('CASE-AB12');
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la demande' }));
    await userEvent.type(screen.getByLabelText('Motif de la suppression'), 'cree par erreur');
    await userEvent.click(screen.getByRole('button', { name: 'Le patient + la demande' }));
    await waitFor(() => expect(deleteRequest).toHaveBeenCalledWith('tk1', 'cree par erreur', true));
  });
});
