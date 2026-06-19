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
});

function renderAt(path: string, curation: CurationRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider templates={templateRepo} curation={curation}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/curation" element={<CurationPool />} />
            <Route path="/curation/:taskId" element={<CurationTask />} />
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
