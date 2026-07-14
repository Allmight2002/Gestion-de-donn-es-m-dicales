// @vitest-environment jsdom
// Tests des parcours de creation (cahier v3.0) : choix "Entrer moi-meme / Confier au staff"
// pour patient et rencontre, et le mode "submit" de NewPatient (identite -> demande au pool).
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
import { PatientCreateChoice } from './PatientCreateChoice';
import { EncounterCreateChoice } from './EncounterCreateChoice';
import { NewPatient } from './NewPatient';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository } from '../../data/patients';
import type { CurationRepository } from '../../data/curation';

const listing: BaseListing = {
  base: { id: 'b1', name: 'B', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner',
  permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
  templateName: 'Neuro', versionNumber: 1,
};
const baseRepo = { async getBase() { return listing; } } as unknown as BaseRepository;
const templateRepo = {
  async getVersion() { return { version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' as const }, fields: [], rules: [] }; },
} as unknown as TemplateRepository;

function renderAt(path: string, providers: { patients?: PatientRepository; curation?: CurationRepository }) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={baseRepo} templates={templateRepo} patients={providers.patients} curation={providers.curation}>
        <ToastProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/bases/:id/patients/new" element={<PatientCreateChoice />} />
              <Route path="/bases/:id/patients/new/manual" element={<div>MANUAL</div>} />
              <Route path="/bases/:id/patients/new/submit" element={<NewPatient mode="submit" />} />
              <Route path="/bases/:id/patients/:patientId/encounters/new" element={<EncounterCreateChoice />} />
              <Route path="/bases/:id/patients/:patientId/encounters/new/manual" element={<div>ENC MANUAL</div>} />
              <Route path="/bases/:id/patients/:patientId" element={<div>FICHE</div>} />
              <Route path="/curation/:taskId" element={<div>CASE PAGE</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('PatientCreateChoice', () => {
  test('propose les 2 options et redirige vers le formulaire manuel', async () => {
    renderAt('/bases/b1/patients/new', {});
    expect(screen.getByText('Entrer les données moi-même')).toBeInTheDocument();
    expect(screen.getByText('Confier les documents au staff')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Entrer les données moi-même'));
    expect(await screen.findByText('MANUAL')).toBeInTheDocument();
  });
});

describe('NewPatient mode submit', () => {
  test('nom + date de naissance requis ; cree atomiquement le patient et la demande au pool', async () => {
    const createPatientCuration = vi.fn(async () => ({ patientId: 'p1', patientCode: 'P-0001', taskId: 'tk9', submissionId: 's9', replayed: false }));
    const createPatient = vi.fn();
    const createSubmission = vi.fn();
    const patients = { async listPatients() { return []; }, async findIdentityMatches() { return []; }, createPatient } as unknown as PatientRepository;
    const curation = { createPatientCuration, createSubmission } as unknown as CurationRepository;

    renderAt('/bases/b1/patients/new/submit', { patients, curation });
    await screen.findByText(/confier un patient au staff/i);
    fireEvent.change(screen.getByLabelText(/nom complet/i), { target: { value: 'Marie Test' } });
    fireEvent.change(screen.getByLabelText(/date de naissance/i), { target: { value: '1990-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));

    expect(await screen.findByText('CASE PAGE')).toBeInTheDocument();
    expect(createPatientCuration).toHaveBeenCalledWith('b1', expect.objectContaining({ fullName: 'Marie Test', dateOfBirth: '1990-01-01', idempotencyKey: expect.any(String) }));
    expect(createPatient).not.toHaveBeenCalled();
    expect(createSubmission).not.toHaveBeenCalled();
  });

  test('rejoue la meme operation apres une reponse perdue sans etre bloque par son propre doublon', async () => {
    const findIdentityMatches = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ patientId: 'p1', code: 'P-0001', fullName: 'Marie Retry', dateOfBirth: '1990-01-01' }]);
    const createPatientCuration = vi.fn()
      .mockRejectedValueOnce(new Error('Gateway Timeout'))
      .mockResolvedValue({ patientId: 'p1', patientCode: 'P-0001', taskId: 'tk9', submissionId: 's9', replayed: true });
    const patients = { async listPatients() { return []; }, findIdentityMatches } as unknown as PatientRepository;
    const curation = { createPatientCuration } as unknown as CurationRepository;

    renderAt('/bases/b1/patients/new/submit', { patients, curation });
    await screen.findByText(/confier un patient au staff/i);
    fireEvent.change(screen.getByLabelText(/nom complet/i), { target: { value: 'Marie Retry' } });
    fireEvent.change(screen.getByLabelText(/date de naissance/i), { target: { value: '1990-01-01' } });

    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));
    await waitFor(() => expect(createPatientCuration).toHaveBeenCalledTimes(1));
    const firstKey = createPatientCuration.mock.calls[0][1].idempotencyKey;

    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));
    expect(await screen.findByText('CASE PAGE')).toBeInTheDocument();
    expect(createPatientCuration).toHaveBeenCalledTimes(2);
    expect(createPatientCuration.mock.calls[1][1].idempotencyKey).toBe(firstKey);
  });

  test('une saisie modifiee apres echec reste soumise au controle de doublon', async () => {
    const match = { patientId: 'p1', code: 'P-0001', fullName: 'Marie Retry', dateOfBirth: '1990-01-01' };
    const findIdentityMatches = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([match]);
    const createPatientCuration = vi.fn().mockRejectedValue(new Error('Gateway Timeout'));
    const patients = { async listPatients() { return []; }, findIdentityMatches } as unknown as PatientRepository;
    const curation = { createPatientCuration } as unknown as CurationRepository;

    renderAt('/bases/b1/patients/new/submit', { patients, curation });
    await screen.findByText(/confier un patient au staff/i);
    fireEvent.change(screen.getByLabelText(/nom complet/i), { target: { value: 'Marie Retry' } });
    fireEvent.change(screen.getByLabelText(/date de naissance/i), { target: { value: '1990-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));
    await waitFor(() => expect(createPatientCuration).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/code patient/i), { target: { value: 'P-0099' } });
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));

    await waitFor(() => expect(screen.getAllByText(/cochez la confirmation pour cr.er quand m.me/i).length).toBeGreaterThan(1));
    expect(createPatientCuration).toHaveBeenCalledTimes(1);
  });
});

describe('NewPatient : detection de doublon', () => {
  test('previent si un patient au meme nom + date de naissance existe, et ouvre sa fiche', async () => {
    const findIdentityMatches = vi.fn(async () => [{ patientId: 'p9', code: 'P-0009', fullName: 'Marie Test', dateOfBirth: '1990-01-01' }]);
    const patients = {
      async listPatients() { return []; },
      findIdentityMatches,
      async createPatient() { return { id: 'p1', code: 'P-0001' }; },
    } as unknown as PatientRepository;
    renderAt('/bases/b1/patients/new/submit', { patients });
    await screen.findByText(/confier un patient au staff/i);
    fireEvent.change(screen.getByLabelText(/nom complet/i), { target: { value: 'Marie Test' } });
    fireEvent.change(screen.getByLabelText(/date de naissance/i), { target: { value: '1990-01-01' } });

    expect(await screen.findByText(/existe déjà dans cette base/i)).toBeInTheDocument();
    expect(screen.getByText('P-0009')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir sa fiche' }));
    expect(await screen.findByText('FICHE')).toBeInTheDocument();
  });

  test('QA : soumission RAPIDE (avant le debounce) -> le doublon est quand meme detecte au submit', async () => {
    // Scenario de l'agent QA : remplir et soumettre immediatement, sans laisser les 400 ms de
    // debounce aboutir. La re-verification FRAICHE au moment du submit doit bloquer.
    const findIdentityMatches = vi.fn(async () => [{ patientId: 'p9', code: 'P-0009', fullName: 'Marie Test', dateOfBirth: '1990-01-01' }]);
    const createPatient = vi.fn(async () => ({ id: 'p1', code: 'P-0001' }));
    const patients = { async listPatients() { return []; }, findIdentityMatches, createPatient } as unknown as PatientRepository;
    const curation = { async createPatientCuration() { return { taskId: 't1' }; } } as unknown as CurationRepository;
    renderAt('/bases/b1/patients/new/submit', { patients, curation });
    await screen.findByText(/confier un patient au staff/i);
    fireEvent.change(screen.getByLabelText(/nom complet/i), { target: { value: 'Marie Test' } });
    fireEvent.change(screen.getByLabelText(/date de naissance/i), { target: { value: '1990-01-01' } });
    // Soumettre IMMEDIATEMENT (pas d'attente de l'avertissement debounce).
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));
    expect(createPatient).not.toHaveBeenCalled(); // bloque par la re-verification au submit
    await waitFor(() => expect(screen.getAllByText(/cochez la confirmation pour créer quand même/i).length).toBeGreaterThan(1));
  });

  test('QA : un code patient deja utilise affiche un message humain (pas le SQL brut)', async () => {
    const createPatientCuration = vi.fn(async () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint "uq_identity_base_code"'), { code: '23505' });
    });
    const patients = { async listPatients() { return []; }, async findIdentityMatches() { return []; } } as unknown as PatientRepository;
    const curation = { createPatientCuration } as unknown as CurationRepository;
    renderAt('/bases/b1/patients/new/submit', { patients, curation });
    await screen.findByText(/confier un patient au staff/i);
    fireEvent.change(screen.getByLabelText(/nom complet/i), { target: { value: 'Autre Nom' } });
    fireEvent.change(screen.getByLabelText(/date de naissance/i), { target: { value: '1985-03-03' } });
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));
    await waitFor(() => expect(screen.getAllByText(/déjà utilisé dans cette base/i).length).toBeGreaterThan(1));
    expect(screen.queryByText(/duplicate key/i)).not.toBeInTheDocument(); // plus de SQL brut
  });

  test('B5 : un doublon exige une confirmation explicite avant de creer le dossier', async () => {
    const findIdentityMatches = vi.fn(async () => [{ patientId: 'p9', code: 'P-0009', fullName: 'Marie Test', dateOfBirth: '1990-01-01' }]);
    const createPatientCuration = vi.fn(async () => ({ patientId: 'p1', taskId: 't1', submissionId: 's1', replayed: false }));
    const patients = { async listPatients() { return []; }, findIdentityMatches } as unknown as PatientRepository;
    const curation = { createPatientCuration } as unknown as CurationRepository;
    renderAt('/bases/b1/patients/new/submit', { patients, curation });
    await screen.findByText(/confier un patient au staff/i);
    fireEvent.change(screen.getByLabelText(/nom complet/i), { target: { value: 'Marie Test' } });
    fireEvent.change(screen.getByLabelText(/date de naissance/i), { target: { value: '1990-01-01' } });
    await screen.findByText(/existe déjà dans cette base/i);

    // Soumettre SANS confirmer : rien n'est cree, un message demande la confirmation.
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));
    expect(createPatientCuration).not.toHaveBeenCalled();
    expect(screen.getAllByText(/cochez la confirmation pour créer quand même/i).length).toBeGreaterThan(1);

    // Cocher « patient différent » puis soumettre : le dossier est cree.
    await userEvent.click(screen.getByLabelText(/patient différent/i));
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));
    await waitFor(() => expect(createPatientCuration).toHaveBeenCalledTimes(1));
  });
});

describe('EncounterCreateChoice', () => {
  test('"Confier au staff" cree une demande de portee encounter et ouvre le cas', async () => {
    const createSubmission = vi.fn(async () => ({ taskId: 'tk9', submissionId: 's9' }));
    const curation = { createSubmission } as unknown as CurationRepository;
    renderAt('/bases/b1/patients/p1/encounters/new', { curation });
    await userEvent.click(screen.getByText('Confier les documents au staff'));
    await waitFor(() => expect(createSubmission).toHaveBeenCalledWith('b1', 'p1', null, 'encounter'));
    expect(await screen.findByText('CASE PAGE')).toBeInTheDocument();
  });
});
