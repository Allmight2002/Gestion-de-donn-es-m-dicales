// @vitest-environment jsdom
// E5 — complétion des dossiers existants après une évolution additive du formulaire.
//
// La fixture est ENTIÈREMENT FICTIVE et partagée avec le banc de vérification navigateur
// (`src/dev/CompletionHarness.tsx`) : la saisie réelle est donc jugée sur exactement la même
// définition que ces tests. Le contexte serveur y est reconstruit avec les décisions de la RPC
// E3 ; les écrans ne décident rien eux-mêmes et n'envoient que le complément réellement saisi.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { Encounter, PatientListItem, PatientRepository } from '../../data/patients';
import type { AttachmentRepository } from '../../data/attachments';
import {
  RECORD_VERSION, fixtureBaseRepository, fixtureRecordContext, fixtureTemplateRepository,
} from '../../test/fixtures/recordCompletion';
import { EditPatient } from './EditPatient';
import { EditEncounter } from './EditEncounter';
import { PatientDetail } from './PatientDetail';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'u', fullName: 'Médecin fictif', globalRole: 'medecin', language: 'fr' },
    user: { id: 'u', email: null },
  }),
}));

const OLD = RECORD_VERSION;

const bases = fixtureBaseRepository;
const templates = fixtureTemplateRepository;
const serverContext = fixtureRecordContext;


const receipt = (kind: 'patient' | 'encounter', id: string) => ({
  recordKind: kind, recordId: id, recordRevision: 4, validationStatus: 'curated',
  operationId: 'op', activeRevision: 2, recordDefinitionRevision: OLD,
  contextFingerprint: `sha256:${'b'.repeat(64)}`,
});

function patientRepository(
  data: Record<string, unknown>,
  update = vi.fn(async () => receipt('patient', 'p1')),
) {
  const patient: PatientListItem = {
    id: 'p1', code: 'P-1', templateVersionId: OLD, data, validationStatus: 'curated', version: 3, identity: null,
  };
  return {
    update,
    repository: {
      async getPatient() { return patient; },
      async getPatientFormContext() { return serverContext('patient', 'p1', data); },
      updatePatientCompatible: update,
    } as unknown as PatientRepository,
  };
}

function patientScreen(patients: PatientRepository): ReactElement {
  return (
    <I18nProvider>
      <RepositoryProvider bases={bases} templates={templates} patients={patients}>
        <MemoryRouter initialEntries={['/bases/b1/patients/p1/edit']}>
          <Routes>
            <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
            <Route path="/bases/b1/patients/p1" element={<p>Fiche patient</p>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>
  );
}

const fillReason = (text: string) => fireEvent.change(
  screen.getByLabelText(/motif de la correction/i), { target: { value: text } },
);
// Les deux ecrans partagent le libelle historique du bouton d'enregistrement.
const saveButton = () => screen.getByRole('button', { name: /enregistrer la rencontre/i });
const stepLabels = () => within(screen.getByRole('navigation', { name: /sommaire du formulaire/i }))
  .getAllByRole('button').map((button) => button.textContent);

describe('E5 — complétion des patients existants', () => {
  test('un ajout facultatif et un ajout obligatoire sont vides, marqués « À renseigner » et comptés', async () => {
    const { repository } = patientRepository({ diagnostic: ['D1'], historique: 'ancien' });
    render(patientScreen(repository));

    expect(await screen.findByLabelText('Ajout facultatif')).toHaveValue('');
    expect(screen.getByLabelText('Ajout obligatoire')).toHaveValue('');
    // Ajouts applicables : les deux du bloc « Suivi », plus le bloc D1 rendu éligible par D1.
    expect(screen.getByText(/4 variable\(s\) ajoutée\(s\) au formulaire/)).toBeInTheDocument();
    expect(screen.getByText(/Dont 1 attendue\(s\) par le formulaire courant/)).toBeInTheDocument();
    expect(screen.getAllByText('À renseigner')).toHaveLength(4);
    // L'obligation nouvelle n'est jamais présentée comme une erreur de la fiche.
    expect(screen.queryByText('Erreurs à corriger')).not.toBeInTheDocument();
  });

  test('renseigner un ajout le retire du compteur sans toucher aux autres', async () => {
    const { repository } = patientRepository({ diagnostic: [], historique: 'ancien' });
    render(patientScreen(repository));

    const optional = await screen.findByLabelText('Ajout facultatif');
    expect(screen.getByText(/2 variable\(s\) ajoutée\(s\) au formulaire/)).toBeInTheDocument();
    fireEvent.change(optional, { target: { value: 'complément explicite' } });
    await waitFor(() => expect(screen.getByText(/1 variable\(s\) ajoutée\(s\) au formulaire/)).toBeInTheDocument());
    expect(screen.getAllByText('À renseigner')).toHaveLength(1);
  });

  test('une fiche curatée reste curatée et une correction indépendante s’enregistre sans compléter les ajouts', async () => {
    const { repository, update } = patientRepository({ diagnostic: ['D1'], historique: 'ancien' });
    render(patientScreen(repository));

    fireEvent.change(await screen.findByLabelText('Valeur historique'), { target: { value: 'corrigé' } });
    fillReason('correction fictive indépendante');
    await userEvent.click(saveButton());

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      patch: { historique: 'corrigé' },
      validationStatus: 'curated',
      expectedRecordRevision: 3,
      recordDefinitionRevision: OLD,
    }));
  });

  test('plusieurs diagnostics rendent leurs blocs éligibles, sous-section comprise, sans créer de réponse', async () => {
    const { repository, update } = patientRepository({ diagnostic: ['D1', 'D2'], historique: 'ancien' });
    render(patientScreen(repository));

    await screen.findByLabelText('Ajout facultatif');
    // Chaque sous-section reste une étape séparée : le parent ne l'absorbe pas.
    expect(stepLabels()).toEqual(['Clinique', 'Suivi', 'Bloc D1', 'Bloc D1 detail', 'Bloc D2']);
    expect(screen.getByLabelText('Variable du bloc D1')).toHaveValue('');
    expect(screen.getByLabelText('Variable du detail D1')).toHaveValue('');
    expect(screen.getByLabelText('Variable du bloc D2')).toHaveValue('');
    expect(screen.getByText(/5 variable\(s\) ajoutée\(s\) au formulaire/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Valeur historique'), { target: { value: 'corrigé' } });
    fillReason('correction fictive');
    await userEvent.click(saveButton());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // Un bloc rendu eligible par un diagnostic n'envoie aucune reponse tant que personne
    // ne la saisit : le patch ne porte que la correction demandee.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ patch: { historique: 'corrigé' } }));
  });

  test('un diagnostic sans bloc reste une information : les ajouts restent annoncés et rien ne bloque', async () => {
    const { repository, update } = patientRepository({ diagnostic: ['D3'], historique: 'ancien' });
    render(patientScreen(repository));

    await screen.findByLabelText('Ajout facultatif');
    expect(screen.getByText(/1 diagnostic\(s\) sans bloc spécialisé/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Variable du bloc D1')).not.toBeInTheDocument();
    expect(screen.getByText(/2 variable\(s\) ajoutée\(s\) au formulaire/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Valeur historique'), { target: { value: 'corrigé' } });
    fillReason('correction fictive');
    await userEvent.click(saveButton());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  test('sans diagnostic, aucun bloc n’est compté ni rendu', async () => {
    const { repository } = patientRepository({ historique: 'ancien' });
    render(patientScreen(repository));

    await screen.findByLabelText('Ajout facultatif');
    expect(screen.queryByLabelText('Variable du bloc D1')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Variable du bloc D2')).not.toBeInTheDocument();
    expect(screen.getByText(/2 variable\(s\) ajoutée\(s\) au formulaire/)).toBeInTheDocument();
    expect(stepLabels()).toEqual(['Clinique', 'Suivi']);
  });

  test('un contexte périmé refuse l’écriture, conserve la saisie et propose le rechargement', async () => {
    const stale = Object.assign(new Error('FORM_CONTEXT_CHANGED'), {
      details: JSON.stringify({ code: 'FORM_CONTEXT_CHANGED', action: 'refresh_required' }),
    });
    const update = vi.fn(async () => { throw stale; });
    const { repository } = patientRepository({ diagnostic: ['D1'], historique: 'ancien' }, update);
    render(patientScreen(repository));

    fireEvent.change(await screen.findByLabelText('Ajout facultatif'), { target: { value: 'complément fictif' } });
    fillReason('complétion fictive');
    await userEvent.click(saveButton());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/saisies locales sont conservées/i));
    expect(screen.getByLabelText('Ajout facultatif')).toHaveValue('complément fictif');
    expect(screen.getByLabelText(/motif de la correction/i)).toHaveValue('complétion fictive');
    expect(screen.getByRole('button', { name: /recharger les données/i })).toBeInTheDocument();
  });
});

describe('E5 — complétion des rencontres existantes', () => {
  function encounterScreen(update = vi.fn(async () => receipt('encounter', 'e1'))) {
    const data: Record<string, unknown> = { mesure: 8 };
    const encounter: Encounter = {
      id: 'e1', encounterType: 'consultation', encounterDate: '2026-09-01', validationStatus: 'curated',
      ageValue: 40, ageUnit: 'years', data, updatedAt: '2026-09-16T10:00:00Z', templateVersionId: OLD,
    };
    const patients = {
      async getEncounter() { return encounter; },
      async listFieldChanges() { return []; },
      async getEncounterFormContext() {
        return serverContext('encounter', 'e1', data, { recordRevision: 6, encounterType: 'consultation' });
      },
      updateEncounterCompatible: update,
    } as unknown as PatientRepository;
    render(
      <I18nProvider>
        <RepositoryProvider bases={bases} templates={templates} patients={patients}>
          <MemoryRouter initialEntries={['/bases/b1/patients/p1/encounters/e1/edit']}>
            <Routes>
              <Route path="/bases/:id/patients/:patientId/encounters/:encounterId/edit" element={<EditEncounter />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
    return update;
  }

  test('les ajouts applicables au type de rencontre sont annoncés, celui d’un autre type ne l’est pas', async () => {
    encounterScreen();
    expect(await screen.findByLabelText('Ajout rencontre facultatif')).toHaveValue(null);
    expect(screen.getByLabelText('Ajout rencontre obligatoire')).toHaveValue(null);
    expect(screen.queryByLabelText('Ajout reserve au suivi')).not.toBeInTheDocument();
    expect(screen.getByText(/2 variable\(s\) ajoutée\(s\) au formulaire/)).toBeInTheDocument();
    expect(screen.getByText(/Dont 1 attendue\(s\) par le formulaire courant/)).toBeInTheDocument();
    expect(screen.getAllByText('À renseigner')).toHaveLength(2);
  });

  test('compléter une rencontre curatée n’envoie que l’ajout saisi et conserve son statut', async () => {
    const update = encounterScreen();
    fireEvent.change(await screen.findByLabelText('Ajout rencontre facultatif'), { target: { value: '12' } });
    fillReason('complétion fictive');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer la rencontre/i }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      patch: { ajout_rencontre: 12 },
      validationStatus: 'curated',
      expectedRecordRevision: 6,
      recordDefinitionRevision: OLD,
    }));
  });
});

describe('E5 — la fiche annonce les ajouts et conduit à la complétion', () => {
  const attachments = { async listAttachments() { return []; } } as unknown as AttachmentRepository;

  function fiche(update = vi.fn(async () => receipt('patient', 'p1'))) {
    const data: Record<string, unknown> = { diagnostic: ['D1'], historique: 'ancien' };
    const patient: PatientListItem = {
      id: 'p1', code: 'P-1', templateVersionId: OLD, data, validationStatus: 'curated', version: 3, identity: null,
    };
    const encounter: Encounter = {
      id: 'e1', encounterType: 'consultation', encounterDate: '2026-09-01', validationStatus: 'curated',
      ageValue: 40, ageUnit: 'years', data: { mesure: 8 }, updatedAt: '2026-09-16T10:00:00Z', templateVersionId: OLD,
    };
    const patients = {
      async getPatient() { return patient; },
      async listEncounters() { return [encounter]; },
      async listFieldChanges() { return []; },
      async getPatientFormContext() { return serverContext('patient', 'p1', data); },
      updatePatientCompatible: update,
    } as unknown as PatientRepository;
    render(
      <I18nProvider>
        <RepositoryProvider bases={bases} templates={templates} patients={patients} attachments={attachments}>
          <MemoryRouter initialEntries={['/bases/b1/patients/p1']}>
            <Routes>
              <Route path="/bases/:id/patients/:patientId" element={<PatientDetail />} />
              <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
  }

  test('les ajouts du patient et de la rencontre sont annoncés sans valeur inventée', async () => {
    fiche();
    // Patient : les deux ajouts du bloc « Suivi » et les deux du bloc D1 rendu éligible.
    expect(await screen.findByText(/4 variable\(s\) ajoutée\(s\) au formulaire/)).toBeInTheDocument();
    // Rencontre : l'ajout réservé à un autre type de rencontre n'est pas annoncé.
    expect(screen.getByText(/2 variable\(s\) ajoutée\(s\) au formulaire/)).toBeInTheDocument();
    expect(screen.queryByText('Ajout reserve au suivi')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Aucune valeur n’est créée et le statut de ce dossier reste inchangé/)).toHaveLength(2);
  });

  test('« Compléter cette fiche » ouvre le formulaire sur des ajouts vides', async () => {
    fiche();
    await screen.findByText(/4 variable\(s\) ajoutée\(s\) au formulaire/);
    await userEvent.click(screen.getAllByRole('button', { name: 'Compléter cette fiche' })[0]);

    expect(await screen.findByLabelText('Ajout facultatif')).toHaveValue('');
    expect(screen.getByLabelText('Ajout obligatoire')).toHaveValue('');
  });
});
