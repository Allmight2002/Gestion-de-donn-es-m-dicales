// @vitest-environment jsdom
// =============================================================================
// Tests web du lot O3 (feuille de route Â« saisie hors-ligne Â») : le parcours
// intake-only SANS RESEAU â€”
//   1. NewPatient charge le formulaire depuis le contexte prepare en ligne et
//      enregistre le patient dans la file locale (aucun appel reseau) ;
//   2. BaseHome hors-ligne N'AFFICHE PAS la base : uniquement la file locale ;
//   3. EncounterForm accepte l'identifiant LOCAL et met en file une rencontre
//      DEPENDANTE du patient encore local.
// Les repos fournis ECHOUENT a tout appel : toute voie reseau serait detectee.
// =============================================================================
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseHome } from './BaseHome';
import { NewPatient } from './NewPatient';
import { EncounterForm } from './EncounterForm';
import { PatientDetail } from './PatientDetail';
import { buildSnapshot, offlineCache, setOfflineUser } from '../../data/offline';
import {
  discardIntake, enqueuePatientCreate, INTAKE_CONTEXT_TTL_MS, intakeContextCache, intakeQueue,
  type OfflineIntakeContext,
} from '../../data/offlineIntake';import type { BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository } from '../../data/patients';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u', fullName: 'M', globalRole: 'medecin', language: 'fr' }, user: { id: 'u', email: null }, signOut: () => {} }),
}));

const forbidNetwork = new Proxy(
  {},
  { get: () => async () => { throw new Error('reseau interdit hors-ligne'); } },
) as unknown as BaseRepository & TemplateRepository & PatientRepository;

const CTX: OfflineIntakeContext = {
  dataType: 'intake_context',
  baseId: 'b-intake',
  baseName: 'Base saisie',
  templateVersionId: 'v1',
  observationModel: 'longitudinal',
  fields: [
    { id: 'f-sexe', fieldKey: 'sexe', label: 'Sexe', scope: 'patient', section: 'clinique', type: 'select', unit: null, allowedValues: ['M', 'F'], allowedOptions: null, required: true, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0 },
    { id: 'f-glasgow', fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', section: 'clinique', type: 'integer', unit: null, allowedValues: null, allowedOptions: null, required: true, minValue: 3, maxValue: 15, allowMissingCodes: false, displayOrder: 1 },
  ],
  rules: [],
  permissions: { canCreateStructuredData: true, canEditStructuredData: true, canViewIdentity: true },
  preparedAt: Date.now(),
  expiresAt: Date.now() + INTAKE_CONTEXT_TTL_MS,
};

function renderAt(path: string, element: React.ReactNode, routePath: string) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={forbidNetwork} templates={forbidNetwork} patients={forbidNetwork}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={element} />
            <Route path="/bases/:id" element={<div>ACCUEIL BASE</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

async function clearLocalState(): Promise<void> {
  const entries = await intakeQueue.list();
  for (const e of entries) await discardIntake(e.id);
  await intakeContextCache.remove('b-intake');
}

beforeAll(async () => {
  vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  vi.stubEnv('VITE_OFFLINE_ADMIN_ACK', 'true');
  vi.stubEnv('VITE_OFFLINE_INTAKE', 'demo');
  setOfflineUser('intake-web-user');
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
});

beforeEach(async () => {
  // Appareil vierge pour chaque test : la file locale d'un test echoue ne fuit pas.
  for (const e of await intakeQueue.list()) await discardIntake(e.id);
});

afterAll(async () => {
  await clearLocalState();
  setOfflineUser(null);
  vi.unstubAllEnvs();
});

describe('NewPatient hors-ligne (intake-only)', () => {
  test('le formulaire vient du contexte ; la creation reste LOCALE (file), sans reseau', async () => {
    const user = userEvent.setup();
    await intakeContextCache.save(CTX);

    renderAt('/bases/b-intake/patients/new/manual', <NewPatient mode="manual" />, '/bases/:id/patients/new/manual');
    // Le gabarit affiche est celui du CONTEXTE (pas un appel reseau).
    expect(await screen.findByText('Sexe')).toBeInTheDocument();
    // Identite visible : le droit a ete RESOLU EN LIGNE lors de la preparation.
    expect(screen.getByLabelText('Nom complet')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nom complet'), 'Marie Local');
    await user.type(screen.getByLabelText('Date de naissance'), '1992-02-02');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));

    // Retour a l'accueil de la base = panneau des saisies locales.
    expect(await screen.findByText('ACCUEIL BASE')).toBeInTheDocument();

    const entries = await intakeQueue.list('b-intake');
    expect(entries).toHaveLength(1);
    const patient = entries[0];
    if (patient.kind !== 'patient_create') throw new Error('kind inattendu');
    expect(patient.state).toBe('pending');
    expect(patient.payload.fullName).toBe('Marie Local'); // identite cloisonnee dans la file
    expect(patient.payload.code).toMatch(/^H-[0-9A-F]{8}$/); // code genere depuis la cle
    expect(patient.ownerUserId).toBe('intake-web-user'); // cloisonnement par compte

    await discardIntake(patient.id);
  });
});

describe('BaseHome hors-ligne (intake-only)', () => {
  test('la lecture de la base est indisponible ; seule la file locale est affichee', async () => {
    await intakeContextCache.save(CTX);
    // Un instantane analytique EXISTE pourtant : il ne doit PAS etre lu ni reconstruit.
    await offlineCache.save(
      buildSnapshot(
        { id: 'b-intake', name: 'Base saisie', templateVersionId: 'v1' },
        [{ id: 'p-srv', code: 'P-SRV', templateVersionId: 'v1', data: {}, validationStatus: 'curated' }],
        {},
        [],
        Date.now(),
      ),
    );
    const entry = await enqueuePatientCreate({
      baseId: 'b-intake',
      operationKey: 'op-web-panel',
      payload: { code: 'H-WEB0001', fullName: 'Paul Attente', dateOfBirth: '1988-08-08', phone: null, address: null, externalIdentifier: null, permanentData: {} },
    });

    renderAt('/bases/b-intake', <BaseHome />, '/bases/:id');
    expect(await screen.findByText(/consultation de la base est indisponible/i)).toBeInTheDocument();
    expect(await screen.findByText('H-WEB0001')).toBeInTheDocument(); // la file locale EST visible
    expect(screen.queryByText('P-SRV')).not.toBeInTheDocument(); // jamais la base existante
    expect(screen.queryByText(/Lecture seule \(hors-ligne\)/)).not.toBeInTheDocument();

    await discardIntake(entry.id);
    await offlineCache.remove('b-intake');
  });
});

describe('EncounterForm hors-ligne (dossier local)', () => {
  test('accepte l identifiant local et met en file une rencontre DEPENDANTE', async () => {
    const user = userEvent.setup();
    await intakeContextCache.save(CTX);
    const parent = await enqueuePatientCreate({
      baseId: 'b-intake',
      operationKey: 'op-web-parent',
      payload: { code: 'H-WEB0002', fullName: 'Paul Parent', dateOfBirth: '1988-08-08', phone: null, address: null, externalIdentifier: null, permanentData: {} },
    });

    renderAt(`/bases/b-intake/patients/${parent.localPatientId}/encounters/new`, <EncounterForm />, '/bases/:id/patients/:patientId/encounters/new');
    // Le formulaire de rencontre s'ouvre sur le dictionnaire du contexte.
    expect(await screen.findByText('Glasgow')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Date de la rencontre'), '2026-08-21');
    await user.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));

    expect(await screen.findByText('ACCUEIL BASE')).toBeInTheDocument();
    const entries = await intakeQueue.list('b-intake');
    const enc = entries.find((e): e is Extract<typeof e, { kind: 'encounter_create' }> => e.kind === 'encounter_create');
    expect(enc?.parentOperationKey).toBe(parent.id); // dependance explicite
    expect(enc?.payload.encounterDate).toBe('2026-08-21');

    await discardIntake(parent.id); // cascade : supprime aussi la rencontre dependante
  });

  test('refuse une rencontre pour un patient SERVEUR hors-ligne (hors perimetre)', async () => {
    renderAt('/bases/b-intake/patients/p-uuid-serveur/encounters/new', <EncounterForm />, '/bases/:id/patients/:patientId/encounters/new');
    expect(await screen.findByText(/seules les rencontres des dossiers encore locaux/i)).toBeInTheDocument();
    expect(await intakeQueue.list('b-intake')).toHaveLength(0);
  });
});

describe('PatientDetail hors-ligne (intake-only)', () => {
  test('l identifiant LOCAL ouvre une vue dediee SANS aucun appel reseau', async () => {
    await intakeContextCache.save(CTX);
    const parent = await enqueuePatientCreate({
      baseId: 'b-intake',
      operationKey: 'op-detail-local',
      payload: {
        code: 'H-DETAIL01', fullName: 'Paul Local', dateOfBirth: '1980-10-10',
        phone: null, address: null, externalIdentifier: null,
        permanentData: { sexe: 'M' },
      },
    });

    renderAt(`/bases/b-intake/patients/${parent.localPatientId}`, <PatientDetail />, '/bases/:id/patients/:patientId');
    // L'identite en attente est visible ICI (file cloisonnee), jamais depuis un snapshot.
    expect(await screen.findByText(/Nouveau patient/i)).toBeInTheDocument();
    expect(screen.getByText('H-DETAIL01')).toBeInTheDocument();
    expect(screen.getByText('Paul Local')).toBeInTheDocument();
    expect(screen.getByText('1980-10-10')).toBeInTheDocument();

    await discardIntake(parent.id);
  });

  test('un identifiant SERVEUR est bloque explicitement hors-ligne (jamais reconstruit)', async () => {
    renderAt('/bases/b-intake/patients/p-uuid-serveur', <PatientDetail />, '/bases/:id/patients/:patientId');
    expect(await screen.findByText(/seules les rencontres des dossiers encore locaux/i)).toBeInTheDocument();
  });
});
