// @vitest-environment jsdom
// Motif facultatif pour tous (migration 20260922193000_optional_reasons) : le serveur accepte
// un motif absent pour toute opération déjà autorisée et le journalise comme tel. L'écran ne
// réclame donc de texte à personne et n'envoie jamais de motif fabriqué.
// Données entièrement fictives.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { BaseListing, BaseRepository } from '../../data/bases';
import type { PatientListItem, PatientRepository } from '../../data/patients';
import type { TemplateRepository } from '../../data/templates';
import type { Profile } from '../../auth/types';
import type { TemplateField } from '../../data/types';
import { EditPatient } from './EditPatient';
import { EditPatientIdentity } from './EditPatientIdentity';

const medecin: Profile = { id: 'u', fullName: 'Médecin fictif', globalRole: 'medecin', language: 'fr' };
let currentProfile: Profile = medecin;
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ profile: currentProfile, user: { id: currentProfile.id, email: null } }),
}));

const field = (fieldKey: string, label: string): TemplateField => ({
  id: fieldKey, fieldKey, label, section: 'clinique', type: 'text', unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, scope: 'patient',
});

const templates = {
  async getVersion(versionId: string) {
    return {
      version: { id: versionId, templateId: 't1', versionNumber: 1, status: 'published' as const },
      fields: [field('historique', 'Valeur historique')],
      rules: [],
      sections: [],
    };
  },
} as unknown as TemplateRepository;

function listing(role: BaseListing['role'], over: Partial<BaseListing> = {}): BaseListing {
  return {
    base: { id: 'b1', name: 'Base fictive', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
    role,
    permissions: {
      canViewIdentity: true, canViewRawDocuments: false, canEditStructuredData: true,
      canExportData: false, canManageAccess: role === 'owner',
    },
    templateName: 'Formulaire fictif',
    versionNumber: 1,
    ...over,
  };
}

const patient: PatientListItem = {
  id: 'p1', code: 'P-1', templateVersionId: 'v1', data: { historique: 'ancien' },
  validationStatus: 'draft', version: 3,
  identity: { fullName: 'Nom fictif', dateOfBirth: '1990-01-01', phone: null, address: null, externalIdentifier: null },
};

type UpdatePatientData = PatientRepository['updatePatientData'];

function renderEditPatient(
  base: BaseListing,
  update: ReturnType<typeof vi.fn<UpdatePatientData>> = vi.fn<UpdatePatientData>(async () => ({ version: 4, updatedAt: null })),
) {
  const bases = { async getBase() { return base; } } as unknown as BaseRepository;
  const patients = {
    async getPatient() { return patient; },
    updatePatientData: update,
  } as unknown as PatientRepository;
  render(
    <I18nProvider>
      <RepositoryProvider bases={bases} templates={templates} patients={patients}>
        <MemoryRouter initialEntries={['/bases/b1/patients/p1/edit']}>
          <Routes>
            <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
            <Route path="/bases/b1/patients/p1" element={<p>Fiche patient</p>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
  return update;
}

const save = () => userEvent.click(screen.getByRole('button', { name: /enregistrer la rencontre/i }));

describe('motif facultatif', () => {
  test('le propriétaire enregistre une correction sans motif et rien n’est fabriqué', async () => {
    currentProfile = medecin;
    const update = renderEditPatient(listing('owner'));

    fireEvent.change(await screen.findByLabelText(/valeur historique/i), { target: { value: 'corrigé' } });
    expect(screen.getByText('Facultatif')).toBeInTheDocument();
    await save();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // Quatrième argument = motif : vide, jamais un texte inventé à la place de l'utilisateur.
    expect(update.mock.calls[0]).toEqual(['p1', { historique: 'corrigé' }, 'draft', '', 3]);
  });

  test('un collaborateur enregistre aussi sans motif', async () => {
    currentProfile = medecin;
    const update = renderEditPatient(listing('editor'));

    fireEvent.change(await screen.findByLabelText(/valeur historique/i), { target: { value: 'corrigé' } });
    expect(screen.getByText('Facultatif')).toBeInTheDocument();
    await save();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][3]).toBe('');
  });

  test('un compte de mission enregistre aussi sans motif', async () => {
    currentProfile = { ...medecin, globalRole: 'saisisseur' };
    const update = renderEditPatient(listing('editor'));

    fireEvent.change(await screen.findByLabelText(/valeur historique/i), { target: { value: 'corrigé' } });
    await save();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][3]).toBe('');
    currentProfile = medecin;
  });

  test('une erreur réseau après une correction sans motif conserve la saisie', async () => {
    currentProfile = medecin;
    const update = vi.fn<UpdatePatientData>(async () => { throw new Error('Echec reseau fictif'); });
    renderEditPatient(listing('owner'), update);

    fireEvent.change(await screen.findByLabelText(/valeur historique/i), { target: { value: 'corrigé' } });
    await save();

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/echec reseau fictif/i));
    expect(screen.getByLabelText(/valeur historique/i)).toHaveValue('corrigé');
  });

  test('la correction d’identité accepte aussi un motif vide', async () => {
    currentProfile = medecin;
    const updateIdentity = vi.fn<PatientRepository['updatePatientIdentity']>(async () => ({ version: 4, updatedAt: null }));
    const bases = { async getBase() { return listing('owner'); } } as unknown as BaseRepository;
    const patients = {
      async getPatient() { return patient; },
      async findIdentityMatches() { return []; },
      updatePatientIdentity: updateIdentity,
    } as unknown as PatientRepository;
    render(
      <I18nProvider>
        <RepositoryProvider bases={bases} templates={templates} patients={patients}>
          <MemoryRouter initialEntries={['/bases/b1/patients/p1/identity/edit']}>
            <Routes>
              <Route path="/bases/:id/patients/:patientId/identity/edit" element={<EditPatientIdentity />} />
              <Route path="/bases/b1/patients/p1" element={<p>Fiche patient</p>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('Facultatif')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /enregistrer la correction/i }));

    await waitFor(() => expect(updateIdentity).toHaveBeenCalledTimes(1));
    expect(updateIdentity.mock.calls[0][2]).toBe('');
  });
});
