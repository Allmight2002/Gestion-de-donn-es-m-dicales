// @vitest-environment jsdom
// Tests des parcours de creation (cahier v3.0) : choix "Entrer moi-meme / Confier au staff"
// pour patient et rencontre, et le mode "submit" de NewPatient (identite -> demande au pool).
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { PatientCreateChoice } from './PatientCreateChoice';
import { EncounterCreateChoice } from './EncounterCreateChoice';
import { NewPatient } from './NewPatient';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository, NewPatientInput } from '../../data/patients';
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
  test('nom + date de naissance requis ; cree le patient puis la demande au pool', async () => {
    const createPatient = vi.fn(async (_b: string, _i: NewPatientInput) => ({ id: 'p1', code: 'P-0001' }));
    const createSubmission = vi.fn(async () => ({ taskId: 'tk9', submissionId: 's9' }));
    const patients = { async listPatients() { return []; }, async findIdentityMatches() { return []; }, createPatient } as unknown as PatientRepository;
    const curation = { createSubmission } as unknown as CurationRepository;

    renderAt('/bases/b1/patients/new/submit', { patients, curation });
    await screen.findByText(/confier un patient au staff/i);
    fireEvent.change(screen.getByLabelText(/nom complet/i), { target: { value: 'Marie Test' } });
    fireEvent.change(screen.getByLabelText(/date de naissance/i), { target: { value: '1990-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));

    expect(await screen.findByText('CASE PAGE')).toBeInTheDocument();
    expect(createPatient.mock.calls[0][1]).toMatchObject({ fullName: 'Marie Test', permanentData: {} });
    expect(createSubmission).toHaveBeenCalledWith('b1', 'p1', null, 'patient');
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

  test('B5 : un doublon exige une confirmation explicite avant de creer le dossier', async () => {
    const findIdentityMatches = vi.fn(async () => [{ patientId: 'p9', code: 'P-0009', fullName: 'Marie Test', dateOfBirth: '1990-01-01' }]);
    const createPatient = vi.fn(async () => ({ id: 'p1', code: 'P-0001' }));
    const patients = { async listPatients() { return []; }, findIdentityMatches, createPatient } as unknown as PatientRepository;
    const curation = { async createSubmission() { return { taskId: 't1' }; } } as unknown as CurationRepository;
    renderAt('/bases/b1/patients/new/submit', { patients, curation });
    await screen.findByText(/confier un patient au staff/i);
    fireEvent.change(screen.getByLabelText(/nom complet/i), { target: { value: 'Marie Test' } });
    fireEvent.change(screen.getByLabelText(/date de naissance/i), { target: { value: '1990-01-01' } });
    await screen.findByText(/existe déjà dans cette base/i);

    // Soumettre SANS confirmer : rien n'est cree, un message demande la confirmation.
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));
    expect(createPatient).not.toHaveBeenCalled();
    expect(screen.getByText(/cochez la confirmation pour créer quand même/i)).toBeInTheDocument();

    // Cocher « patient différent » puis soumettre : le dossier est cree.
    await userEvent.click(screen.getByLabelText(/patient différent/i));
    await userEvent.click(screen.getByRole('button', { name: 'Continuer vers les documents' }));
    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
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
