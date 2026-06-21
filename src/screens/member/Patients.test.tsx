// @vitest-environment jsdom
// Tests de rendu de l'etape 6 (patient) avec repositories INJECTES.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { NewPatient } from './NewPatient';
import { BaseHome } from './BaseHome';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository, PatientListItem, NewPatientInput } from '../../data/patients';
import type { TemplateField } from '../../data/types';

const ALL_PERMS = {
  canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true,
  canValidateData: true, canExportData: true, canManageAccess: true,
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
    const patientRepo = { async listPatients() { return []; }, createPatient } as unknown as PatientRepository;

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
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));

    expect(await screen.findByText('FICHE PAGE')).toBeInTheDocument();
    expect(createPatient).toHaveBeenCalledTimes(1);
    expect(createPatient.mock.calls[0][1]).toMatchObject({ fullName: 'Marie Test' });
  });
});

describe('BaseHome (liste patients)', () => {
  test('affiche le nom si acces identite, sinon "identite masquee"', async () => {
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

    expect(await screen.findByText('Jean Avec')).toBeInTheDocument();
    expect(screen.getByText('(identité masquée)')).toBeInTheDocument();
    expect(screen.getByText('P-0001')).toBeInTheDocument();
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
