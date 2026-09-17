// Banc de VERIFICATION LOCALE de la complétion des dossiers existants (lot E5).
//
// Il monte les VRAIS écrans (`PatientDetail`, `EditPatient`, `EditEncounter`) avec le vrai
// i18n, les vrais composants de saisie et le vrai moteur de règles, sur la fixture fictive
// partagée avec les tests web (`src/test/fixtures/recordCompletion.ts`). Aucun accès réseau,
// aucun Supabase, aucune donnée réelle : un dépôt en mémoire répond à la place du serveur et
// recalcule le contexte E3 après chaque enregistrement.
//
// Ce fichier n'est atteignable que depuis `completion-harness.html`, servie par le serveur de
// développement. Le build de production n'a qu'une seule entrée (`index.html`).

import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider';
import { ToastProvider } from '../components/Toast';
import { I18nProvider } from '../i18n/I18nProvider';
import { RepositoryProvider } from '../data/RepositoryProvider';
import type {
  CompatibleEncounterUpdateInput, CompatiblePatientUpdateInput, CompatibleRecordUpdateReceipt,
  Encounter, PatientListItem, PatientRepository,
} from '../data/patients';
import type { AttachmentRepository } from '../data/attachments';
import type { WorkDraftRepository } from '../data/workDrafts';
import {
  RECORD_VERSION, fixtureBaseRepository, fixtureRecordContext, fixtureTemplateRepository,
} from '../test/fixtures/recordCompletion';
import { PatientDetail } from '../screens/member/PatientDetail';
import { EditPatient } from '../screens/member/EditPatient';
import { EditEncounter } from '../screens/member/EditEncounter';
import { initTheme } from '../lib/theme';
import '../index.css';

initTheme();

const profile = { id: 'u', fullName: 'Médecin fictif', globalRole: 'medecin' as const, language: 'fr' };
const auth = {
  status: 'authenticated', user: { id: 'u', email: null }, profile, error: null, busy: false,
  async signIn() { return true; },
  async signOut() { /* aucun backend dans le banc */ },
  async sendPasswordReset() { return true; },
  async updatePassword() { return true; },
} as unknown as AuthContextValue;

// Aucun brouillon serveur : une fiche existante avec contexte E3 passe par le patch compatible.
const noDrafts = { available: false } as unknown as WorkDraftRepository;
const noAttachments = { async listAttachments() { return []; } } as unknown as AttachmentRepository;

/**
 * Dépôt en mémoire : il fusionne le patch comme le ferait la RPC (les clés historiques sont
 * conservées, seul le complément envoyé est appliqué) puis rend un contexte recalculé.
 */
function useMemoryPatients() {
  const [patient, setPatient] = useState<PatientListItem>({
    id: 'p1', code: 'P-0001', templateVersionId: RECORD_VERSION,
    data: { diagnostic: ['D1'], historique: 'valeur fictive enregistrée avant l’évolution' },
    validationStatus: 'curated', version: 3, identity: null,
  });
  const [encounter, setEncounter] = useState<Encounter>({
    id: 'e1', encounterType: 'consultation', encounterDate: '2026-09-01', validationStatus: 'curated',
    ageValue: 41, ageUnit: 'years', data: { mesure: 8 }, updatedAt: '2026-09-16T10:00:00Z',
    templateVersionId: RECORD_VERSION,
  });
  const [log, setLog] = useState<string[]>([]);

  return useMemo<{ repository: PatientRepository; log: string[] }>(() => {
    const merge = (data: Record<string, unknown>, patch: Record<string, unknown>) => {
      const next = { ...data };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete next[key]; else next[key] = value;
      }
      return next;
    };
    const receipt = (kind: 'patient' | 'encounter', id: string, revision: number): CompatibleRecordUpdateReceipt => ({
      recordKind: kind, recordId: id, recordRevision: revision, validationStatus: 'curated',
      operationId: 'op', activeRevision: 2, recordDefinitionRevision: RECORD_VERSION,
      contextFingerprint: `sha256:${'b'.repeat(64)}`,
    });
    const repository = {
      async getPatient() { return patient; },
      async listEncounters() { return [encounter]; },
      async listFieldChanges() { return []; },
      async getEncounter() { return encounter; },
      async getPatientFormContext() {
        return fixtureRecordContext('patient', 'p1', patient.data, { recordRevision: patient.version ?? 3 });
      },
      async getEncounterFormContext() {
        return fixtureRecordContext('encounter', 'e1', encounter.data, { recordRevision: 6, encounterType: encounter.encounterType });
      },
      async updatePatientCompatible(input: CompatiblePatientUpdateInput) {
        setLog((before) => [`patient · patch ${JSON.stringify(input.patch)} · motif « ${input.reason} »`, ...before]);
        setPatient((before) => ({ ...before, data: merge(before.data, input.patch), version: (before.version ?? 3) + 1 }));
        return receipt('patient', 'p1', (patient.version ?? 3) + 1);
      },
      async updateEncounterCompatible(input: CompatibleEncounterUpdateInput) {
        setLog((before) => [`rencontre · patch ${JSON.stringify(input.patch)} · motif « ${input.reason} »`, ...before]);
        setEncounter((before) => ({ ...before, data: merge(before.data, input.patch) }));
        return receipt('encounter', 'e1', 7);
      },
    } as unknown as PatientRepository;
    return { repository, log };
  }, [patient, encounter, log]);
}

function Harness() {
  const { repository, log } = useMemoryPatients();
  return (
    <I18nProvider>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RepositoryProvider
            bases={fixtureBaseRepository}
            templates={fixtureTemplateRepository}
            patients={repository}
            attachments={noAttachments}
            workDrafts={noDrafts}
          >
            <div className="mx-auto max-w-[1100px] space-y-4 p-4 sm:p-6">
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Banc de vérification locale — données ENTIÈREMENT FICTIVES. Le formulaire de la
                base a reçu une évolution additive : deux variables de suivi (dont une attendue
                par le formulaire courant) et deux blocs diagnostiques. Aucun serveur, aucun
                dossier réel.
              </p>
              <MemoryRouter initialEntries={['/bases/b1/patients/p1']}>
                <Routes>
                  <Route path="/bases/:id/patients/:patientId" element={<PatientDetail />} />
                  <Route path="/bases/:id/patients/:patientId/edit" element={<EditPatient />} />
                  <Route path="/bases/:id/patients/:patientId/encounters/:encounterId/edit" element={<EditEncounter />} />
                </Routes>
              </MemoryRouter>
              <section className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600">
                <h2 className="font-semibold text-slate-700">Écritures reçues par le faux serveur</h2>
                {log.length === 0
                  ? <p className="mt-1 text-slate-400">Aucune écriture pour l’instant.</p>
                  : <ul className="mt-1 space-y-1 font-mono">{log.map((line, index) => <li key={index}>{line}</li>)}</ul>}
              </section>
            </div>
          </RepositoryProvider>
        </ToastProvider>
      </AuthContext.Provider>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
