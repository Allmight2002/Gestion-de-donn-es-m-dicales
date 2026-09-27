// @vitest-environment jsdom
// Tests de rendu de l'etape 8 (fiche patient + correction) avec repos INJECTES.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { PatientDetail } from './PatientDetail';
import { EditPatient } from './EditPatient';
import { EditPatientIdentity } from './EditPatientIdentity';
import { EditEncounter } from './EditEncounter';
import type { BaseRepository, BaseListing } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository, Encounter, PatientListItem, FieldChange } from '../../data/patients';
import type { AttachmentRepository } from '../../data/attachments';
import type { AuditRepository } from '../../data/audit';
import type { TemplateField } from '../../data/types';
import { setBirthDate } from '../../../test/helpers/date-picker';
import { TopBarRegistryProvider, useTopBarRegistry } from '../../components/TopBar';
import type { ReactNode } from 'react';

// EditPatient / EditEncounter lisent le role global (profil de medecin par defaut
// pour ces tests de correction).
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u', fullName: 'M', globalRole: 'medecin', language: 'fr' }, user: { id: 'u', email: null }, signOut: () => {} }),
}));

const stubAttachments = { async listAttachments() { return []; }, async addImage() { return { id: '' }; } } as unknown as AttachmentRepository;

const ALL_PERMS = {
  canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true,
  canExportData: true, canManageAccess: true,
};
const baseListing: BaseListing = {
  base: { id: 'b1', name: 'Base', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner', permissions: ALL_PERMS, templateName: 'Neuro', versionNumber: 1,
};
function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'type' | 'scope'>): TemplateField {
  return { id: p.fieldKey, section: 'clinique', unit: null, allowedValues: null, required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...p };
}
const baseRepo = { async getBase() { return baseListing; } } as unknown as BaseRepository;
const templateRepo = {
  async getVersion() {
    return {
      version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
      fields: [
        field({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'] }),
        field({ fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', type: 'integer', required: true, minValue: 3, maxValue: 15 }),
        field({ fieldKey: 'diagnostic', label: 'Diagnostic', scope: 'encounter', type: 'terminology' }),
      ],
      rules: [],
    };
  },
} as unknown as TemplateRepository;

const patientView: PatientListItem = {
  id: 'p1', code: 'P-0001', templateVersionId: 'v1', data: { sexe: 'M' }, validationStatus: 'curated',
  version: 7,
  updatedAt: '2026-07-11T10:00:00.123456Z',
  identity: { fullName: 'Jean Test', dateOfBirth: '1980-01-01', phone: null, address: null, externalIdentifier: null },
};
const encounter: Encounter = {
  id: 'e1', encounterType: 'consultation', encounterDate: '2024-06-01', validationStatus: 'complete',
  ageValue: 44, ageUnit: 'years',
  data: { glasgow_score: 12, diagnostic: { code: '1F40', label: 'Paludisme' } },
};
const historyRows: FieldChange[] = [{ fieldKey: 'glasgow_score', oldValue: 10, newValue: 12, reason: 'correction saisie', changedAt: '2024-06-02' }];

function makePatients(over: Partial<PatientRepository> = {}): PatientRepository {
  return {
    async listPatients() { return []; },
    async createPatient() { return { id: '', code: '' }; },
    async getPatient() { return patientView; },
    async computeAge() { return 44; },
    async createEncounter() { return { id: 'e1' }; },
    async listEncounters() { return [encounter]; },
    async getEncounter() { return encounter; },
    async updateEncounter() { return { id: 'e1' }; },
    async listFieldChanges() { return historyRows; },
    ...over,
  } as unknown as PatientRepository;
}

function renderAt(
  path: string,
  patients: PatientRepository,
  audit?: AuditRepository,
  templates: TemplateRepository = templateRepo,
  attachments: AttachmentRepository = stubAttachments,
  baseRepository: BaseRepository = baseRepo,
) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={baseRepository} templates={templates} patients={patients} attachments={attachments} audit={audit}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/bases/:id/patients/:patientId" element={<PatientDetail />} />
            <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
            <Route path="/bases/:id/patients/:patientId/identity/edit" element={<EditPatientIdentity />} />
            <Route path="/bases/:id/patients/:patientId/encounters/:encounterId/edit" element={<EditEncounter />} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

// Audit UI mobile, lot 2 : l'identite (D1) et les rencontres sont repliees par defaut. On les
// deplie avant toute verification de leur contenu, positive OU negative : chercher un bouton
// dans un bloc replie ne prouverait rien.
async function openIdentity() {
  await userEvent.click(await screen.findByRole('button', { name: 'Identité (zone restreinte)' }));
}
async function openEncounters() {
  for (const toggle of document.querySelectorAll<HTMLElement>('button[aria-controls^="encounter-"][aria-expanded="false"]')) {
    await userEvent.click(toggle);
  }
}

describe('PatientDetail (fiche)', () => {
  test('affiche identite (si autorisee), donnees permanentes et rencontres', async () => {
    renderAt('/bases/b1/patients/p1', makePatients());
    expect(await screen.findByText('Jean Test')).toBeInTheDocument(); // identite
    expect(screen.getByText('Glasgow')).toBeInTheDocument(); // libelle champ rencontre
    expect(screen.getByText('12')).toBeInTheDocument(); // valeur de la rencontre
    expect(screen.getByText('Paludisme')).toBeInTheDocument(); // libelle lisible de la terminologie
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifier les données permanentes' })).toBeInTheDocument();
    await openIdentity();
    expect(screen.getByRole('button', { name: 'Corriger l’identité' })).toBeInTheDocument();
  });

  // Regression release 177 : un gabarit SANS variable permanente visible masquait la carte
  // ENTIERE, emportant avec elle le statut du dossier, la correction des donnees permanentes
  // et la finalisation -- inatteignables depuis la fiche. La condition ne doit porter que sur
  // la LISTE des variables, jamais sur les actions de la carte.
  test('garde les actions permanentes quand le gabarit n a aucune variable de patient', async () => {
    const sansVariablePatient = {
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
          fields: [field({ fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', type: 'integer' })],
          rules: [],
        };
      },
    } as unknown as TemplateRepository;

    renderAt('/bases/b1/patients/p1', makePatients(), undefined, sansVariablePatient);

    expect(await screen.findByText('Jean Test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifier les données permanentes' })).toBeInTheDocument();
    // La liste, elle, reste vide : la condition a ete DEPLACEE, pas supprimee.
    expect(screen.queryByText('Sexe')).not.toBeInTheDocument();
  });

  test('affiche l unite des variables numeriques dans la consultation', async () => {
    const consultationTemplateRepo = {
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
          fields: [
            field({ fieldKey: 'poids', label: 'Poids', scope: 'patient', type: 'number', unit: 'kg' }),
            field({ fieldKey: 'temperature', label: 'Température', scope: 'encounter', type: 'number', unit: '°C' }),
          ],
          rules: [],
        };
      },
    } as unknown as TemplateRepository;
    const patients = makePatients({
      async getPatient() { return { ...patientView, data: { poids: 72.5 } }; },
      async listEncounters() { return [{ ...encounter, data: { temperature: 38.2 } }]; },
    });

    renderAt('/bases/b1/patients/p1', patients, undefined, consultationTemplateRepo);

    const weightLabel = await screen.findByText('Poids');
    expect(weightLabel.closest('dt')).toHaveTextContent('Poids (kg)');
    expect(screen.getByText('72.5')).toBeInTheDocument();
    const temperatureLabel = screen.getByText('Température');
    expect(temperatureLabel.closest('dt')).toHaveTextContent('Température (°C)');
    expect(screen.getByText('38.2')).toBeInTheDocument();
  });

  test('recalcule une variable temporelle et affiche son unite de restitution', async () => {
    const formulaTemplateRepo = {
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
          fields: [
            field({ fieldKey: 'date_entree', label: 'Date d’entrée', scope: 'encounter', type: 'date' }),
            field({ fieldKey: 'date_sortie', label: 'Date de sortie', scope: 'encounter', type: 'date' }),
            field({
              fieldKey: 'duree', label: 'Durée', scope: 'encounter', type: 'integer', unit: 'hours',
              formula: 'date_sortie - date_entree',
            }),
          ],
          rules: [],
        };
      },
    } as unknown as TemplateRepository;
    const patients = makePatients({
      async listEncounters() {
        return [{
          ...encounter,
          data: { date_entree: '2024-01-01', date_sortie: '2024-01-03' },
        }];
      },
    });

    renderAt('/bases/b1/patients/p1', patients, undefined, formulaTemplateRepo);

    const durationLabel = await screen.findByText('Durée');
    expect(durationLabel.closest('dt')).toHaveTextContent('Durée (heures)');
    expect(screen.getByText('48')).toBeInTheDocument();
  });

  // Audit UI mobile, lot 0 — une base transversale affichait un bloc « Aucune rencontre » vide.
  test('une base transversale sans rencontre n affiche pas le bloc Rencontres ; une rencontre existante reste visible', async () => {
    const crossBase = {
      async getBase() {
        return { ...baseListing, base: { ...baseListing.base, observationModel: 'cross_sectional' as const } };
      },
    } as unknown as BaseRepository;

    const { unmount } = renderAt('/bases/b1/patients/p1', makePatients({ async listEncounters() { return []; } }), undefined, templateRepo, stubAttachments, crossBase);
    expect(await screen.findByText('Jean Test')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rencontres' })).not.toBeInTheDocument();
    expect(screen.queryByText('Aucune rencontre.')).not.toBeInTheDocument();
    unmount();

    renderAt('/bases/b1/patients/p1', makePatients(), undefined, templateRepo, stubAttachments, crossBase);
    expect(await screen.findByRole('heading', { name: 'Rencontres' })).toBeInTheDocument();
    expect(screen.getByText('Paludisme')).toBeInTheDocument();
  });

  // Audit UI mobile, lot 7 — le garde-fou 360 px a trouve deux boutons pleins sur la fiche.
  test('un seul bouton plein : « Ajouter une rencontre » en base longitudinale, « Modifier » sinon', async () => {
    const { unmount } = renderAt('/bases/b1/patients/p1', makePatients());
    expect(await screen.findByRole('button', { name: 'Modifier les données permanentes' })).toHaveClass('btn-secondary');
    const add = screen.getAllByRole('button', { name: 'Ajouter une rencontre' });
    expect(add.length).toBeGreaterThan(0);
    for (const button of add) expect(button).toHaveClass('btn-primary');
    unmount();

    const crossBase = {
      async getBase() {
        return { ...baseListing, base: { ...baseListing.base, observationModel: 'cross_sectional' as const } };
      },
    } as unknown as BaseRepository;
    renderAt('/bases/b1/patients/p1', makePatients(), undefined, templateRepo, stubAttachments, crossBase);
    expect(await screen.findByRole('button', { name: 'Modifier les données permanentes' })).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Ajouter une rencontre' })).not.toBeInTheDocument();
  });

  test('une base longitudinale sans rencontre garde le bloc Rencontres', async () => {
    renderAt('/bases/b1/patients/p1', makePatients({ async listEncounters() { return []; } }));
    expect(await screen.findByRole('heading', { name: 'Rencontres' })).toBeInTheDocument();
    expect(screen.getByText('Aucune rencontre.')).toBeInTheDocument();
  });

  // Audit UI mobile, lot 0 — la fiche affichait « 2026-08-21T14:00 » et « 0.286111 ».
  test('affiche dates, dates-heures et resultats calcules lisibles, sans toucher aux valeurs', async () => {
    const readableTemplateRepo = {
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
          fields: [
            field({ fieldKey: 'naissance', label: 'Date de naissance', scope: 'patient', type: 'date', displayOrder: 0 }),
            field({ fieldKey: 'trauma', label: 'Traumatisme', scope: 'patient', type: 'datetime', displayOrder: 1 }),
            field({ fieldKey: 'admission', label: 'Admission', scope: 'patient', type: 'datetime', displayOrder: 2 }),
            field({
              fieldKey: 'delai', label: 'Délai', scope: 'patient', type: 'number', unit: 'days', displayOrder: 3,
              formula: 'admission - trauma',
            }),
          ],
          rules: [],
        };
      },
    } as unknown as TemplateRepository;
    const patients = makePatients({
      async getPatient() {
        return { ...patientView, data: { naissance: '2014-02-18', trauma: '2026-08-21T14:00', admission: '2026-08-21T20:52' } };
      },
    });

    renderAt('/bases/b1/patients/p1', patients, undefined, readableTemplateRepo);

    expect(await screen.findByText('18/02/2014')).toBeInTheDocument();
    expect(screen.getByText('21/08/2026 14:00')).toBeInTheDocument();
    expect(screen.getByText('21/08/2026 20:52')).toBeInTheDocument();
    expect(screen.getByText('0,29')).toBeInTheDocument();
    expect(screen.queryByText('2026-08-21T14:00')).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.2861/)).not.toBeInTheDocument();
  });

  test('organise les variables permanentes et de rencontre par section', async () => {
    const sectionsTemplateRepo = {
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
          fields: [
            field({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'], section: 'identification', sectionLabel: 'Identification', sectionOrder: 0 }),
            field({ fieldKey: 'mecanisme', label: 'Mécanisme', scope: 'patient', type: 'text', section: 'circonstances', sectionLabel: 'Circonstances', sectionOrder: 1 }),
            field({ fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', type: 'integer', section: 'examen', sectionLabel: 'Examen initial', sectionOrder: 2 }),
          ],
          rules: [],
          sections: [],
        };
      },
    } as unknown as TemplateRepository;
    const patient = { ...patientView, data: { sexe: 'M', mecanisme: 'Chute' } };
    const patients = makePatients({
      async getPatient() { return patient; },
      async listEncounters() { return [{ ...encounter, data: { glasgow_score: 12 } }]; },
    });

    renderAt('/bases/b1/patients/p1', patients, undefined, sectionsTemplateRepo);

    // Lot 2 : les sections permanentes sont des regions titrees ; celles de la rencontre
    // restent des groupes, dans la rencontre depliee.
    const identification = await screen.findByRole('region', { name: 'Identification' });
    const circonstances = screen.getByRole('region', { name: 'Circonstances' });
    await openEncounters();
    const examen = screen.getByRole('group', { name: 'Examen initial' });
    expect(within(identification).getByText('Sexe')).toBeInTheDocument();
    expect(within(circonstances).getByText('Mécanisme')).toBeInTheDocument();
    expect(within(examen).getByText('Glasgow')).toBeInTheDocument();
  });

  test('ne rend ni le bloc ni sa sous-section quand la visibilité du bloc est fausse', async () => {
    const blockTemplateRepo = {
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
          fields: [
            field({ fieldKey: 'diagnostic', label: 'Diagnostic', scope: 'encounter', type: 'terminology', section: null }),
            field({ fieldKey: 'mesure_bloc', label: 'Mesure du bloc', scope: 'encounter', type: 'number', section: 'bloc' }),
            field({ fieldKey: 'detail_bloc', label: 'Détail de la sous-section', scope: 'encounter', type: 'text', section: 'bloc_detail', parentSectionKey: 'bloc' }),
          ],
          rules: [{
            id: 'r-block',
            rule: { if: { field: 'diagnostic', operator: 'equals', value: 'actif' }, then: { section: 'bloc', operator: 'visible' } },
            message: null,
            severity: 'block' as const,
          }],
          sections: [
            { id: 's-block', sectionKey: 'bloc', label: 'Bloc clinique', displayOrder: 0, parentSectionKey: null },
            { id: 's-detail', sectionKey: 'bloc_detail', label: 'Sous-section', displayOrder: 1, parentSectionKey: 'bloc' },
          ],
        };
      },
    } as unknown as TemplateRepository;
    const patients = makePatients({
      async listEncounters() {
        return [{ ...encounter, data: { diagnostic: 'inactif', mesure_bloc: 42, detail_bloc: 'secret fictif' } }];
      },
    });

    renderAt('/bases/b1/patients/p1', patients, undefined, blockTemplateRepo);

    await screen.findByText('Diagnostic');
    expect(screen.queryByText('Bloc clinique')).not.toBeInTheDocument();
    expect(screen.queryByText('Sous-section')).not.toBeInTheDocument();
    expect(screen.queryByText('Mesure du bloc')).not.toBeInTheDocument();
    expect(screen.queryByText('Détail de la sous-section')).not.toBeInTheDocument();
  });

  // Chantier D : un refus de `signed-read` etait avale en silence ; l'utilisateur ne voyait
  // qu'un libelle « Erreur » indiscernable d'un fichier manquant.
  test('affiche le motif du refus renvoye par signed-read', async () => {
    const attachments = {
      async listAttachments() {
        return [{
          id: 'a1', kind: 'image', label: 'Scanner', filePath: 'b1/p1/a1.png',
          mimeType: 'image/png', inspectionStatus: 'accepted' as const,
        }];
      },
      async attachmentUrl() {
        throw new Error('Fichier en quarantaine : lecture refusee');
      },
    } as unknown as AttachmentRepository;

    renderAt('/bases/b1/patients/p1', makePatients(), undefined, templateRepo, attachments);
    await userEvent.click(await screen.findByRole('button', { name: /Afficher l.image/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fichier en quarantaine : lecture refusee');
  });

  test('ne double-journalise pas l identite cote client', async () => {
    const logIdentityRead = vi.fn(async () => {});
    renderAt('/bases/b1/patients/p1', makePatients(), { logIdentityRead } as unknown as AuditRepository);
    await screen.findByText('Jean Test');
    expect(logIdentityRead).not.toHaveBeenCalled();
  });

  test('supprimer le patient exige un motif puis appelle softDeletePatient', async () => {
    const softDeletePatient = vi.fn(async (_id: string, _reason: string) => {});
    renderAt('/bases/b1/patients/p1', makePatients({ softDeletePatient }));
    await screen.findByText(/Jean Test/);
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer ce patient' }));
    fireEvent.change(screen.getByLabelText('Motif de la suppression'), { target: { value: 'doublon' } });
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(softDeletePatient).toHaveBeenCalledWith('p1', 'doublon'));
  });

  test('un simple lecteur ne voit pas la suppression du patient', async () => {
    const viewerBase: BaseListing = {
      ...baseListing,
      role: 'viewer',
      permissions: { ...ALL_PERMS, canEditStructuredData: false, canManageAccess: false },
    };
    const viewerRepo = { async getBase() { return viewerBase; } } as unknown as BaseRepository;
    renderAt('/bases/b1/patients/p1', makePatients(), undefined, templateRepo, stubAttachments, viewerRepo);
    await screen.findByText('Jean Test');
    expect(screen.queryByRole('button', { name: 'Supprimer ce patient' })).not.toBeInTheDocument();
  });

  test('le saisisseur ne voit Corriger l identite que sur son propre brouillon autorise', async () => {
    const missionBase: BaseListing = {
      ...baseListing,
      role: 'editor',
      permissions: {
        canViewIdentity: true,
        canViewRawDocuments: false,
        canEditStructuredData: false,
        canExportData: false,
        canManageAccess: false,
      },
      canCreateStructuredData: true,
      expiresAt: '2099-01-01T00:00:00Z',
      currentUserId: 'mission-1',
    };
    const missionRepo = { async getBase() { return missionBase; } } as unknown as BaseRepository;
    const ownDraft = { ...patientView, validationStatus: 'draft', createdBy: 'mission-1' };
    const first = renderAt(
      '/bases/b1/patients/p1',
      makePatients({ getPatient: async () => ownDraft }),
      undefined,
      templateRepo,
      stubAttachments,
      missionRepo,
    );
    await openIdentity();
    expect(screen.getByRole('button', { name: 'Corriger l’identité' })).toBeInTheDocument();
    first.unmount();

    const submitted = renderAt(
      '/bases/b1/patients/p1',
      makePatients({ getPatient: async () => ({ ...ownDraft, validationStatus: 'complete' }) }),
      undefined,
      templateRepo,
      stubAttachments,
      missionRepo,
    );
    await screen.findByText('Jean Test');
    await openIdentity();
    expect(screen.queryByRole('button', { name: 'Corriger l’identité' })).not.toBeInTheDocument();
    submitted.unmount();

    renderAt(
      '/bases/b1/patients/p1',
      makePatients({ getPatient: async () => ({ ...ownDraft, createdBy: 'mission-2' }) }),
      undefined,
      templateRepo,
      stubAttachments,
      missionRepo,
    );
    await screen.findByText('Jean Test');
    await openIdentity();
    expect(screen.queryByRole('button', { name: 'Corriger l’identité' })).not.toBeInTheDocument();
  });
});

describe('EditPatientIdentity (correction nominative)', () => {
  test('corrige les cinq champs avec motif et version sur le brouillon propre du saisisseur', async () => {
    const updatePatientIdentity = vi.fn(async () => ({ version: 8, updatedAt: '2026-08-11T12:00:00Z' }));
    const missionPatient: PatientListItem = {
      ...patientView,
      validationStatus: 'draft',
      createdBy: 'mission-1',
    };
    const missionBase: BaseListing = {
      ...baseListing,
      role: 'editor',
      permissions: {
        canViewIdentity: true,
        canViewRawDocuments: false,
        canEditStructuredData: false,
        canExportData: false,
        canManageAccess: false,
      },
      canCreateStructuredData: true,
      expiresAt: '2099-01-01T00:00:00Z',
      currentUserId: 'mission-1',
    };
    const missionRepo = { async getBase() { return missionBase; } } as unknown as BaseRepository;
    renderAt(
      '/bases/b1/patients/p1/identity/edit',
      makePatients({
        getPatient: async () => missionPatient,
        findIdentityMatches: async () => [],
        updatePatientIdentity,
      }),
      undefined,
      templateRepo,
      stubAttachments,
      missionRepo,
    );

    fireEvent.change(await screen.findByLabelText('Nom complet'), { target: { value: 'Jeanne Exemple' } });
    await setBirthDate('1981-02-03');
    fireEvent.change(screen.getByLabelText('Téléphone'), { target: { value: '+235 60 00 00 00' } });
    fireEvent.change(screen.getByLabelText('Adresse'), { target: { value: 'Quartier fictif, N’Djamena' } });
    fireEvent.change(screen.getByLabelText('Identifiant externe'), { target: { value: 'EXT-FICTIF-9' } });
    fireEvent.change(screen.getByLabelText(/Motif de la correction/), { target: { value: 'Correction depuis le cahier de saisie' } });
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() => expect(updatePatientIdentity).toHaveBeenCalledWith(
      'p1',
      {
        fullName: 'Jeanne Exemple',
        dateOfBirth: '1981-02-03',
        phone: '+235 60 00 00 00',
        address: 'Quartier fictif, N’Djamena',
        externalIdentifier: 'EXT-FICTIF-9',
      },
      'Correction depuis le cahier de saisie',
      7,
    ));
  });

  test('repasse par l avertissement de doublon avant la correction', async () => {
    const updatePatientIdentity = vi.fn(async () => ({ version: 8, updatedAt: null }));
    const match = { patientId: 'p2', code: 'P-0002', fullName: 'Doublon Fictif', dateOfBirth: '1990-01-01' };
    renderAt(
      '/bases/b1/patients/p1/identity/edit',
      makePatients({ findIdentityMatches: async () => [match], updatePatientIdentity }),
    );

    fireEvent.change(await screen.findByLabelText('Nom complet'), { target: { value: 'Doublon Fictif' } });
    await setBirthDate('1990-01-01');
    fireEvent.change(screen.getByLabelText(/Motif de la correction/), { target: { value: 'Correction doublon contrôlée' } });
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/autre dossier porte déjà/i);
    expect(updatePatientIdentity).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('checkbox', { name: /patient différent/i }));
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    await waitFor(() => expect(updatePatientIdentity).toHaveBeenCalledTimes(1));
  });
});

describe('EditEncounter (correction)', () => {
  test('§7.4 une rencontre HISTORIQUE s edite avec SA version de gabarit, pas la version courante', async () => {
    // La base est en v1 (courante) ; la rencontre a ete saisie sous v-old.
    const getVersion = vi.fn(async (vid: string) => ({
      version: { id: vid, templateId: 't1', versionNumber: vid === 'v-old' ? 1 : 2, status: 'published' as const },
      fields: [field({ fieldKey: 'glasgow_score', label: vid === 'v-old' ? 'Glasgow (ancien libelle)' : 'Glasgow', scope: 'encounter', type: 'integer' })],
      rules: [],
    }));
    renderAt(
      '/bases/b1/patients/p1/encounters/e1/edit',
      makePatients({ getEncounter: async () => ({ ...encounter, templateVersionId: 'v-old' }) }),
      undefined,
      { getVersion } as unknown as TemplateRepository,
    );
    // Le dictionnaire charge est celui DE LA RENCONTRE (v-old), pas celui de la base (v1).
    // (Le libelle apparait dans le formulaire ET dans l'historique des corrections.)
    expect((await screen.findAllByText('Glasgow (ancien libelle)')).length).toBeGreaterThan(0);
    expect(getVersion).toHaveBeenCalledWith('v-old');
    expect(getVersion).not.toHaveBeenCalledWith('v1');
  });

  // Le motif est facultatif pour tous (`OptionalJustification.test.tsx`) ; saisi, il est transmis.
  test('le motif reste transmis quand il est saisi ; historique affiche', async () => {
    const updateEncounter = vi.fn(async (_id: string, _data: Record<string, unknown>, _status: string, _reason: string) => ({ id: 'e1' }));
    renderAt('/bases/b1/patients/p1/encounters/e1/edit', makePatients({ updateEncounter }));

    // Historique des corrections affiche.
    expect(await screen.findByText(/correction saisie/)).toBeInTheDocument();
    expect(screen.getByText('Facultatif')).toBeInTheDocument();

    // Avec motif -> enregistre, et le texte saisi est transmis tel quel.
    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'erreur de frappe' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    expect(updateEncounter).toHaveBeenCalledTimes(1);
    expect(updateEncounter.mock.calls[0][3]).toBe('erreur de frappe');
  });

  test('un ancien draft incomplet reste editable et enregistrable', async () => {
    const updateEncounter = vi.fn(
      async (_id: string, _data: Record<string, unknown>, _status: string, _reason: string) => ({ id: 'e1' }),
    );
    renderAt(
      '/bases/b1/patients/p1/encounters/e1/edit',
      makePatients({
        getEncounter: async () => ({ ...encounter, validationStatus: 'draft', data: {} }),
        updateEncounter,
      }),
    );

    expect(await screen.findByLabelText('Glasgow')).toHaveValue(null);
    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'brouillon conserve' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    await waitFor(() => expect(updateEncounter).toHaveBeenCalledTimes(1));
    expect(updateEncounter.mock.calls[0][1]).toEqual({});
    expect(updateEncounter.mock.calls[0][2]).toBe('draft');
  });

  test('le passage draft vers curated est bloque tant que la saisie est incomplete', async () => {
    const updateEncounter = vi.fn(
      async (_id: string, _data: Record<string, unknown>, _status: string, _reason: string) => ({ id: 'e1' }),
    );
    renderAt(
      '/bases/b1/patients/p1/encounters/e1/edit',
      makePatients({
        getEncounter: async () => ({ ...encounter, validationStatus: 'draft', data: {} }),
        updateEncounter,
      }),
    );

    await screen.findByLabelText('Glasgow');
    fireEvent.change(screen.getByLabelText(/statut du dossier/i), { target: { value: 'curated' } });
    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'promotion' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    expect(screen.getByLabelText('Glasgow')).toHaveAccessibleDescription(/champ obligatoire/i);
    expect(updateEncounter).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Glasgow'), { target: { value: '12' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    await waitFor(() => expect(updateEncounter).toHaveBeenCalledTimes(1));
    expect(updateEncounter.mock.calls[0][2]).toBe('curated');
  });

  test('le passage draft vers complete est bloque tant que la saisie est incomplete', async () => {
    const updateEncounter = vi.fn(
      async (_id: string, _data: Record<string, unknown>, _status: string, _reason: string) => ({ id: 'e1' }),
    );
    renderAt(
      '/bases/b1/patients/p1/encounters/e1/edit',
      makePatients({
        getEncounter: async () => ({ ...encounter, validationStatus: 'draft', data: {} }),
        updateEncounter,
      }),
    );

    // La soumission ('complete') exige desormais la completude, comme 'curated'.
    await screen.findByLabelText('Glasgow');
    fireEvent.change(screen.getByLabelText(/statut du dossier/i), { target: { value: 'complete' } });
    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'soumission' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    expect(screen.getByLabelText('Glasgow')).toHaveAccessibleDescription(/champ obligatoire/i);
    expect(updateEncounter).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Glasgow'), { target: { value: '12' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    await waitFor(() => expect(updateEncounter).toHaveBeenCalledTimes(1));
    expect(updateEncounter.mock.calls[0][2]).toBe('complete');
  });
});

describe('EditPatient (verrou optimiste)', () => {
  test('utilise le regroupement commun pour les sections permanentes non vides', async () => {
    const sectionsTemplateRepo = {
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
          fields: [
            field({ fieldKey: 'symptome', label: 'Symptome patient', scope: 'patient', type: 'text', section: 'clinique' }),
            field({ fieldKey: 'biomarqueur', label: 'Biomarqueur', scope: 'patient', type: 'number', section: 'biologie', displayOrder: 1 }),
            { ...field({ fieldKey: 'historique', label: 'Variable historique', scope: 'patient', type: 'text', displayOrder: 2 }), section: undefined } as unknown as TemplateField,
          ],
          rules: [],
        };
      },
    } as unknown as TemplateRepository;

    renderAt('/bases/b1/patients/p1/edit', makePatients(), undefined, sectionsTemplateRepo);

    // La saisie s'ouvre un bloc a la fois : on demande tous les blocs pour lire le regroupement.
    await userEvent.click(await screen.findByLabelText('Un bloc à la fois'));
    const clinique = await screen.findByRole('group', { name: 'Clinique' });
    const biologie = screen.getByRole('group', { name: 'Biologie' });
    const other = screen.getByRole('group', { name: 'Autre' });
    expect(within(clinique).getByText('Symptome patient')).toBeInTheDocument();
    expect(within(biologie).getByText('Biomarqueur')).toBeInTheDocument();
    expect(within(other).getByText('Variable historique')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Paraclinique' })).not.toBeInTheDocument();
  });

  test('transmet la version chargee et distingue un conflit d une erreur reseau avec rechargement explicite', async () => {
    const getPatient = vi.fn(async () => patientView);
    const updatePatientData = vi.fn(async () => {
      throw new Error('CONFLIT_VERSION : le patient a ete modifie entre-temps');
    });
    renderAt('/bases/b1/patients/p1/edit', makePatients({ getPatient, updatePatientData }));

    await userEvent.click(await screen.findByRole('radio', { name: 'F' }));
    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'correction concurrente' } });
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    expect(updatePatientData).toHaveBeenCalledWith(
      'p1', expect.objectContaining({ sexe: 'F' }), 'curated', 'correction concurrente',
      7,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/modifie par une autre personne/i);
    const reload = screen.getByRole('button', { name: /recharger les données/i });
    await userEvent.click(reload);
    await userEvent.click(screen.getByRole('button', { name: 'Quitter la saisie' }));
    await waitFor(() => expect(getPatient).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: /recharger les donnees/i })).not.toBeInTheDocument());
  });

  // Audit UI mobile, lot 0 — l'ecran reutilisait le libelle de la rencontre.
  test('la modification des donnees permanentes propose « Enregistrer les modifications »', async () => {
    renderAt('/bases/b1/patients/p1/edit', makePatients());

    expect(await screen.findByRole('button', { name: 'Enregistrer les modifications' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enregistrer la rencontre' })).not.toBeInTheDocument();
  });
});

// Audit UI mobile, lot 2 (5.5-B et D1) : une fiche qui se lit d'un coup d'oeil — code en titre,
// valeurs vides masquees mais comptees, identite repliee (toujours chargee), rencontres
// repliees de la plus recente a la plus ancienne, actions secondaires hors du premier niveau.
describe('PatientDetail — fiche allégée (audit UI mobile, lot 2)', () => {
  const threeFields = {
    async getVersion() {
      return {
        version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
        fields: [
          field({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'], displayOrder: 0 }),
          field({ fieldKey: 'poids', label: 'Poids', scope: 'patient', type: 'number', displayOrder: 1 }),
          field({ fieldKey: 'taille', label: 'Taille', scope: 'patient', type: 'number', displayOrder: 2 }),
          field({ fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', type: 'integer', displayOrder: 3 }),
        ],
        rules: [],
      };
    },
  } as unknown as TemplateRepository;

  function TopBarProbe({ children }: { children: ReactNode }) {
    const { active, actions, registry } = useTopBarRegistry();
    return (
      <TopBarRegistryProvider registry={registry}>
        {children}
        <p data-testid="barre">{active ? `${active.title} | ${active.backTo}` : 'vide'} || {actions.map((action) => action.label).join(', ') || 'aucune action'}</p>
      </TopBarRegistryProvider>
    );
  }

  test('les valeurs vides sont masquées, comptées, et rendues sur demande', async () => {
    renderAt('/bases/b1/patients/p1', makePatients(), undefined, threeFields);
    const toggle = await screen.findByRole('button', { name: 'Afficher les champs vides (2)' });
    expect(screen.getByText('Sexe')).toBeVisible();
    expect(screen.getByText('Poids')).not.toBeVisible();
    expect(screen.getByText('1 renseignée(s) sur 3')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByText('Poids')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Masquer les champs vides' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('une section se replie et garde son compte', async () => {
    renderAt('/bases/b1/patients/p1', makePatients(), undefined, threeFields);
    const section = await screen.findByRole('button', { name: /1 renseignée\(s\) sur 3/ });
    expect(section).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(section);
    expect(section).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Sexe')).not.toBeVisible();
  });

  test('D1 : l’identité est chargée à l’ouverture de la fiche, mais repliée', async () => {
    const getPatient = vi.fn(async () => patientView);
    renderAt('/bases/b1/patients/p1', makePatients({ getPatient }));
    const toggle = await screen.findByRole('button', { name: 'Identité (zone restreinte)' });
    // Lecture — donc journal serveur — inchangée : seul l'affichage est replié.
    expect(getPatient).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Jean Test')).not.toBeVisible();
    await userEvent.click(toggle);
    expect(screen.getByText('Jean Test')).toBeVisible();
  });

  test('les rencontres sont repliées, la plus récente en premier', async () => {
    const older: Encounter = { ...encounter, id: 'e-old', encounterDate: '2024-01-10', data: { glasgow_score: 9 } };
    const newer: Encounter = { ...encounter, id: 'e-new', encounterDate: '2024-06-01', data: { glasgow_score: 14 } };
    renderAt('/bases/b1/patients/p1', makePatients({ listEncounters: async () => [older, newer] }), undefined, threeFields);
    await screen.findByText('Sexe');
    const toggles = [...document.querySelectorAll<HTMLElement>('button[aria-controls^="encounter-"]')];
    expect(toggles.map((toggle) => toggle.getAttribute('aria-controls'))).toEqual(['encounter-e-new', 'encounter-e-old']);
    expect(toggles.every((toggle) => toggle.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(screen.getByText('14')).not.toBeVisible();

    await userEvent.click(toggles[0]);
    expect(screen.getByText('14')).toBeVisible();
    expect(screen.getByText('9')).not.toBeVisible();
  });

  test('le code est le titre ; Finaliser passe dans ⋯ ; Supprimer quitte l’en-tête', async () => {
    const draft = { ...patientView, validationStatus: 'draft' as const };
    render(
      <I18nProvider>
        <RepositoryProvider bases={baseRepo} templates={templateRepo} patients={makePatients({ getPatient: async () => draft })} attachments={stubAttachments}>
          <MemoryRouter initialEntries={['/bases/b1/patients/p1']}>
            <TopBarProbe>
              <Routes><Route path="/bases/:id/patients/:patientId" element={<PatientDetail />} /></Routes>
            </TopBarProbe>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'P-0001' })).toHaveClass('max-lg:sr-only');
    expect(screen.getByTestId('barre')).toHaveTextContent('P-0001 | /bases/b1 || Finaliser');
    // A partir de lg, « Finaliser » reste dans la carte, a cote de « Modifier ».
    expect(screen.getByRole('button', { name: 'Finaliser' })).toHaveClass('max-lg:hidden');
    const remove = screen.getByRole('button', { name: 'Supprimer ce patient' });
    expect(remove.closest('header')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Ajouter une rencontre' }).find((button) => button.classList.contains('fixed')))
      .toHaveClass('lg:hidden');
  });
});
