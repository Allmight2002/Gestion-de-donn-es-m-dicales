// @vitest-environment jsdom
// Tests de rendu de l'etape 6 (patient) avec repositories INJECTES.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { NewPatient } from './NewPatient';
import { BaseHome } from './BaseHome';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository, PatientListItem, NewPatientInput } from '../../data/patients';
import type { TemplateField } from '../../data/types';
import { offlineCache, type OfflineSnapshot } from '../../data/offline';

// NewPatient lit le role global (la voie curation est fermee aux comptes de mission).
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u', fullName: 'M', globalRole: 'medecin', language: 'fr' }, user: { id: 'u', email: null }, signOut: () => {} }),
}));

const ALL_PERMS = {
  canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true,
  canExportData: true, canManageAccess: true,
};

const baseListing: BaseListing = {
  base: { id: 'b1', name: 'Registre Neuro', specialty: 'neuro', ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner',
  permissions: ALL_PERMS,
  templateName: 'Neurochirurgie',
  versionNumber: 1,
};

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'scope' | 'type'>): TemplateField {
  return {
    id: p.fieldKey,
    section: 'clinique',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: true,
    displayOrder: 0,
    ...p,
  };
}

const baseRepo = { async getBase() { return baseListing; } } as unknown as BaseRepository;

const templateRepo = {
  async getVersion() {
    return {
      version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
      fields: [
        field({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'] }),
        field({ fieldKey: 'birth_year', label: 'Annee de naissance', scope: 'patient', type: 'integer', displayOrder: 1 }),
        field({ fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', type: 'integer' }),
      ],
      rules: [],
    };
  },
} as unknown as TemplateRepository;

describe('NewPatient', () => {
  test('affiche identite + champs permanents (scope=patient seulement) et cree le patient', async () => {
    const user = userEvent.setup();
    const createPatient = vi.fn(async (_baseId: string, _input: NewPatientInput) => ({ id: 'p1', code: 'P-0001' }));
    const patientRepo = {
      async listPatients() { return []; },
      async findIdentityMatches() { return []; },
      createPatient,
    } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={templateRepo} patients={patientRepo}>
          <MemoryRouter initialEntries={['/bases/b1/patients/new']}>
            <Routes>
              <Route path="/bases/:id/patients/new" element={<NewPatient />} />
              <Route path="/bases/:id/patients/:patientId" element={<div>FICHE PAGE</div>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    // Champ identite + champ permanent scope=patient affiches ; champ rencontre absent.
    expect(await screen.findByText('Nom complet')).toBeInTheDocument();
    expect(screen.getByText('Sexe')).toBeInTheDocument();
    expect(screen.getByText('Annee de naissance')).toBeInTheDocument();
    expect(screen.queryByText('Glasgow')).toBeNull();

    await user.type(screen.getByLabelText('Nom complet'), 'Marie Test');
    await user.type(screen.getByLabelText('Date de naissance'), '1995-04-03');
    await user.type(screen.getByLabelText('Téléphone'), '+235 61 00 00 00');
    await user.type(screen.getByLabelText('Adresse'), 'Adresse fictive');
    await user.type(screen.getByLabelText('Identifiant externe'), 'EXT-FICTIF-1');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));

    expect(await screen.findByText('FICHE PAGE')).toBeInTheDocument();
    expect(createPatient).toHaveBeenCalledTimes(1);
    expect(createPatient.mock.calls[0][1]).toMatchObject({
      fullName: 'Marie Test',
      dateOfBirth: '1995-04-03',
      phone: '+235 61 00 00 00',
      address: 'Adresse fictive',
      externalIdentifier: 'EXT-FICTIF-1',
    });
  });

  test('masque toute la zone identite sans option et envoie des valeurs nominatives nulles', async () => {
    const withoutIdentity: BaseListing = {
      ...baseListing,
      role: 'editor',
      permissions: { ...ALL_PERMS, canViewIdentity: false, canEditStructuredData: false },
      canCreateStructuredData: true,
      expiresAt: '2099-01-01T00:00:00Z',
    };
    const bases = { async getBase() { return withoutIdentity; } } as unknown as BaseRepository;
    const createPatient = vi.fn(async (_baseId: string, _input: NewPatientInput) => ({ id: 'p1', code: 'P-0001' }));
    const patients = { async listPatients() { return []; }, createPatient } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={bases} templates={templateRepo} patients={patients}>
          <MemoryRouter initialEntries={['/bases/b1/patients/new']}>
            <Routes>
              <Route path="/bases/:id/patients/new" element={<NewPatient />} />
              <Route path="/bases/:id/patients/:patientId" element={<div>FICHE PAGE</div>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    await screen.findByText('Sexe');
    expect(screen.queryByRole('group', { name: 'Identité (zone restreinte)' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nom complet')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));
    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    expect(createPatient.mock.calls[0][1]).toMatchObject({
      fullName: null,
      dateOfBirth: null,
      phone: null,
      address: null,
      externalIdentifier: null,
    });
  });

  test('groupe les variables permanentes, masque les sections vides et conserve les variables sans section', async () => {
    const patientRepo = { async listPatients() { return []; } } as unknown as PatientRepository;
    const sectionsTemplateRepo = {
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
          fields: [
            field({ fieldKey: 'symptome', label: 'Symptome', scope: 'patient', type: 'text', section: 'clinique' }),
            field({ fieldKey: 'imagerie', label: 'Imagerie', scope: 'patient', type: 'text', section: 'paraclinique', displayOrder: 1 }),
            { ...field({ fieldKey: 'historique', label: 'Variable historique', scope: 'patient', type: 'text', displayOrder: 2 }), section: undefined } as unknown as TemplateField,
          ],
          rules: [],
        };
      },
    } as unknown as TemplateRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={sectionsTemplateRepo} patients={patientRepo}>
          <MemoryRouter initialEntries={['/bases/b1/patients/new']}>
            <Routes>
              <Route path="/bases/:id/patients/new" element={<NewPatient />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    const clinique = await screen.findByRole('group', { name: 'Clinique' });
    const paraclinique = screen.getByRole('group', { name: 'Paraclinique' });
    const other = screen.getByRole('group', { name: 'Autre' });
    expect(within(clinique).getByText('Symptome')).toBeInTheDocument();
    expect(within(paraclinique).getByText('Imagerie')).toBeInTheDocument();
    expect(within(other).getByText('Variable historique')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Biologie' })).not.toBeInTheDocument();
    expect(
      Array.from(document.querySelectorAll('legend'), (legend) => legend.textContent)
        .filter((legend) => ['Clinique', 'Biologie', 'Paraclinique', 'Autre'].includes(legend ?? '')),
    ).toEqual(['Clinique', 'Paraclinique', 'Autre']);
  });
});

describe('BaseHome (liste patients)', () => {
  test('exige un motif et le nom de la base avant la suppression proprietaire', async () => {
    const user = userEvent.setup();
    const softDeleteBase = vi.fn(async () => undefined);
    const removeOffline = vi.spyOn(offlineCache, 'remove').mockResolvedValue();
    const bases = {
      async getBase() { return baseListing; },
      softDeleteBase,
    } as unknown as BaseRepository;
    const patientRepo = {
      async listPatientsPage() { return { rows: [], total: 0 }; },
    } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={bases} templates={templateRepo} patients={patientRepo}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes>
              <Route path="/bases/:id" element={<BaseHome />} />
              <Route path="/" element={<div>TABLEAU DE BORD</div>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'Actions' }));
    await user.click(screen.getByRole('button', { name: 'Supprimer la base' }));
    const dialog = screen.getByRole('dialog', { name: 'Supprimer cette base ?' });
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer la base' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Motif de la suppression'), 'Création par erreur');
    await user.type(within(dialog).getByLabelText('Saisissez le nom de la base pour confirmer'), 'Registre Neuro');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(softDeleteBase).toHaveBeenCalledWith('b1', 'Création par erreur');
    expect(await screen.findByText('TABLEAU DE BORD')).toBeInTheDocument();
    removeOffline.mockRestore();
  });

  test('place les actions occasionnelles dans un menu compact de l en-tete', async () => {
    const patientRepo = {
      async listPatientsPage() { return { rows: [], total: 0 }; },
    } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={templateRepo} patients={patientRepo}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes>
              <Route path="/bases/:id" element={<BaseHome />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    const menu = await screen.findByRole('button', { name: 'Actions' });
    expect(menu.closest('header')).not.toBeNull();
    await userEvent.click(menu);
    const action = screen.getByRole('button', { name: 'Rendre disponible hors-ligne' });
    expect(action.closest('header')).not.toBeNull();
  });

  test('pilote Nouveau patient par la permission de creation, y compris dans l etat vide', async () => {
    const creatorListing: BaseListing = {
      ...baseListing,
      role: 'editor',
      permissions: { ...ALL_PERMS, canEditStructuredData: false, canManageAccess: false },
      canCreateStructuredData: true,
      expiresAt: '2099-01-01T00:00:00Z',
    };
    const bases = { async getBase() { return creatorListing; } } as unknown as BaseRepository;
    const patients = { async listPatientsPage() { return { rows: [], total: 0 }; } } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={bases} templates={templateRepo} patients={patients}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes><Route path="/bases/:id" element={<BaseHome />} /></Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect((await screen.findAllByRole('button', { name: 'Nouveau patient' })).length).toBe(2);
    expect(screen.getByText('Aucun patient. Cliquez sur « Nouveau patient ».')).toBeInTheDocument();
  });

  test('ne promet pas Nouveau patient a un lecteur sans permission de creation', async () => {
    const readerListing: BaseListing = {
      ...baseListing,
      role: 'viewer',
      permissions: { ...ALL_PERMS, canEditStructuredData: false, canManageAccess: false },
      canCreateStructuredData: false,
    };
    const bases = { async getBase() { return readerListing; } } as unknown as BaseRepository;
    const patients = { async listPatientsPage() { return { rows: [], total: 0 }; } } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={bases} templates={templateRepo} patients={patients}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes><Route path="/bases/:id" element={<BaseHome />} /></Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('Aucun patient dans cette base.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nouveau patient' })).not.toBeInTheDocument();
  });

  test('masque la creation et l actualisation hors-ligne pour un acces a echeance mais garde le retrait', async () => {
    const snapshot: OfflineSnapshot = {
      dataType: 'analytic_snapshot',
      baseId: 'b1',
      baseName: 'Registre Neuro',
      templateVersionId: 'v1',
      fields: [],
      patients: [],
      cachedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const cached = vi.spyOn(offlineCache, 'get').mockResolvedValue(snapshot);
    const expiringListing: BaseListing = {
      ...baseListing,
      role: 'editor',
      permissions: { ...ALL_PERMS, canEditStructuredData: false, canManageAccess: false },
      canCreateStructuredData: true,
      expiresAt: '2099-01-01T00:00:00Z',
    };
    const bases = { async getBase() { return expiringListing; } } as unknown as BaseRepository;
    const patients = { async listPatientsPage() { return { rows: [], total: 0 }; } } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={bases} templates={templateRepo} patients={patients}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes><Route path="/bases/:id" element={<BaseHome />} /></Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Retirer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rendre disponible hors-ligne' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actualiser la copie hors-ligne' })).not.toBeInTheDocument();
    cached.mockRestore();
  });

  test('affiche une valeur de terminologie par son libelle dans la liste', async () => {
    const terminologyTemplateRepo = {
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
          fields: [field({ fieldKey: 'diagnostic', label: 'Diagnostic', scope: 'patient', type: 'terminology' })],
          rules: [],
        };
      },
    } as unknown as TemplateRepository;
    const patient: PatientListItem = {
      id: 'p-terminology',
      code: 'P-TERMINOLOGY',
      templateVersionId: 'v1',
      data: { diagnostic: { code: 'C71.9', label: 'Glioblastome' } },
      validationStatus: 'curated',
      identity: null,
    };
    const patientRepo = {
      async listPatientsPage() { return { rows: [patient], total: 1 }; },
    } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={terminologyTemplateRepo} patients={patientRepo}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes>
              <Route path="/bases/:id" element={<BaseHome />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('Glioblastome')).toBeInTheDocument();
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
  });

  test('purge les patients precedents si la nouvelle base echoue a charger sa liste', async () => {
    const baseB: BaseListing = {
      ...baseListing,
      base: { ...baseListing.base, id: 'b2', name: 'Registre Cardio' },
    };
    const bases = {
      async getBase(baseId: string) { return baseId === 'b2' ? baseB : baseListing; },
    } as unknown as BaseRepository;
    const patientA: PatientListItem = {
      id: 'p-a', code: 'PATIENT-BASE-A', templateVersionId: 'v1', data: {},
      validationStatus: 'curated', identity: null,
    };
    const patients = {
      async listPatientsPage(baseId: string) {
        if (baseId === 'b2') throw new Error('Liste B indisponible');
        return { rows: [patientA], total: 1 };
      },
    } as unknown as PatientRepository;
    function SwitchableBaseHome() {
      const navigate = useNavigate();
      return (
        <>
          <button onClick={() => navigate('/bases/b2')}>Ouvrir base B</button>
          <BaseHome />
        </>
      );
    }

    render(
      <I18nProvider>
        <RepositoryProvider bases={bases} templates={templateRepo} patients={patients}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes>
              <Route path="/bases/:id" element={<SwitchableBaseHome />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('PATIENT-BASE-A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir base B' }));
    expect(await screen.findByText('Registre Cardio')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Liste B indisponible');
    expect(screen.queryByText('PATIENT-BASE-A')).not.toBeInTheDocument();
  });

  test('une erreur de liste ne transforme pas une base accessible en Page introuvable', async () => {
    const patientRepo = {
      async listPatientsPage() { throw new Error('Liste temporairement indisponible'); },
    } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={templateRepo} patients={patientRepo}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes>
              <Route path="/bases/:id" element={<BaseHome />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('Registre Neuro')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Liste temporairement indisponible');
    expect(screen.queryByText('Page introuvable')).not.toBeInTheDocument();
  });

  test('liste PSEUDONYMISEE (§5.8) : affiche le code, JAMAIS le nom (meme si le repo en fournit un)', async () => {
    // Le repo renvoie volontairement une identite : on verifie que la liste ne l'expose PAS
    // (le nom n'est revele que sur la fiche patient, ou la consultation est journalisee).
    const list: PatientListItem[] = [
      {
        id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: { sexe: 'M', birth_year: 1980 }, validationStatus: 'curated',
        identity: { fullName: 'Jean Avec', dateOfBirth: null, phone: null, address: null, externalIdentifier: null },
      },
      { id: 'p2', code: 'P-0002', templateVersionId: 'v1', data: { sexe: 'F', birth_year: 1990 }, validationStatus: 'curated', identity: null },
    ];
    const patientRepo = { async listPatientsPage() { return { rows: list, total: list.length }; }, async createPatient() { return { id: '', code: '' }; } } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={templateRepo} patients={patientRepo}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes>
              <Route path="/bases/:id" element={<BaseHome />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('P-0001')).toBeInTheDocument();
    expect(screen.getByText('P-0002')).toBeInTheDocument();
    expect(screen.queryByText('Jean Avec')).toBeNull();          // le nom n'apparait jamais dans la liste
    expect(screen.queryByText('(identité masquée)')).toBeNull(); // plus de colonne identite du tout
  });

  test('pagine : affiche "1–20 sur 25" et charge la page suivante', async () => {
    const pageRow = (n: number): PatientListItem => ({
      id: `p${n}`, code: `P-${String(n).padStart(4, '0')}`, templateVersionId: 'v1', data: {}, validationStatus: 'curated', identity: null,
    });
    const listPatientsPage = vi.fn(async (_b: string, limit: number, offset: number) => ({
      rows: Array.from({ length: Math.min(limit, 25 - offset) }, (_, i) => pageRow(offset + i + 1)),
      total: 25,
    }));
    const patientRepo = { listPatientsPage, async createPatient() { return { id: '', code: '' }; } } as unknown as PatientRepository;

    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={templateRepo} patients={patientRepo}>
          <MemoryRouter initialEntries={['/bases/b1']}>
            <Routes>
              <Route path="/bases/:id" element={<BaseHome />} />
              <Route path="/bases/:id/patients/:patientId" element={<div>FICHE</div>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    expect(await screen.findByText('1–20 sur 25')).toBeInTheDocument();
    expect(screen.getByText('P-0001')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(await screen.findByText('21–25 sur 25')).toBeInTheDocument();
    expect(listPatientsPage.mock.calls.some(([, , offset]) => offset === 20)).toBe(true);
  });
});
