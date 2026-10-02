// Audit UI mobile, lot 7 (T10) — banc de VERIFICATION LOCALE des ecrans sur telephone.
//
// Il monte l'application telle qu'elle est servie : les vraies routes (`AppRoutes`), la vraie
// coquille, les vrais ecrans et le vrai i18n. Seuls changent la session (un medecin fictif,
// sans serveur d'authentification) et les depots : ils repondent en memoire avec des donnees
// ENTIEREMENT FICTIVES. Un depot sollicite pour une methode que le banc ne simule pas echoue
// bruyamment (« … n'est pas simule ») : jamais de repli silencieux sur le vrai client Supabase.
//
// L'ecran s'ouvre par son adresse, dans le fragment : `mobile-harness.html#/bases/b1`.
// `e2e/mobile-360.spec.ts` s'en sert pour controler les budgets de l'audit a 360 px.
//
// Ce fichier n'est atteignable que depuis `mobile-harness.html`, servie par le serveur de
// developpement. Le build de production n'a qu'une seule entree (`index.html`).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { I18nProvider } from '../i18n/I18nProvider';
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider';
import { RepositoryProvider } from '../data/RepositoryProvider';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ToastProvider } from '../components/Toast';
import { AppRoutes } from '../routes/AppRoutes';
import type { BaseListing, BaseRepository } from '../data/bases';
import { withSections, type TemplateRepository } from '../data/templates';
import type { CompletionItem, Encounter, PatientListItem, PatientRepository } from '../data/patients';
import type { ActivityEvent, AuditRepository } from '../data/audit';
import type { AccessItem, AccessRepository } from '../data/access';
import type { CohortRepository, CohortSummary } from '../data/cohorts';
import type { ExportLogItem, ExportRepository } from '../data/exports';
import type { MissionAccount, MissionRepository } from '../data/mission';
import type { WorkDraftSummary } from '../data/workDrafts';
import type { EntryForm, EntryFormInput, EntryFormRepository } from '../data/entryForms';
import type { CodedConcept, CodedDiagnosis, TerminologyCodingResult, TerminologyRepository } from '../data/terminology';
import { normalizeQuery } from '../data/terminologyCache';
import type { TemplateField, TemplateSection } from '../data/types';
import { createEditorRegistryRepository, editorRegistryVersion } from '../test/fixtures/editorRegistry';
import { initTheme } from '../lib/theme';
import '../index.css';

initTheme();

/**
 * Depot du banc : les methodes fournies repondent ; toute autre methode rejette avec un
 * message qui la nomme (et le journalise une fois), pour que le test dise quoi simuler.
 */
function strict<T>(name: string, methods: Record<string, unknown>): T {
  const reported = new Set<string>();
  return new Proxy(methods, {
    get(target, key) {
      if (typeof key !== 'string' || key === 'then') return undefined;
      if (key in target) return target[key];
      return () => {
        const message = `[banc mobile] ${name}.${key} n'est pas simule`;
        if (!reported.has(key)) {
          reported.add(key);
          console.error(message);
        }
        return Promise.reject(new Error(message));
      };
    },
  }) as T;
}

// --- Session fictive --------------------------------------------------------------------
const profile = { id: 'u-demo', fullName: 'Dr Démo (fictif)', globalRole: 'medecin' as const, language: 'fr' };
const auth: AuthContextValue = {
  status: 'signed_in', user: { id: profile.id, email: null }, profile, error: null, busy: false,
  async signIn() { return true; },
  async signOut() { /* aucun serveur dans le banc */ },
  async sendPasswordReset() { return true; },
  async updatePassword() { return true; },
};

// --- Base et jeu de variables fictifs ---------------------------------------------------
const listing: BaseListing = {
  base: {
    id: 'b1', name: 'Traumatismes crâniens CHU-R (fictif)', specialty: null, ownerUserId: profile.id,
    currentTemplateVersionId: 'v1', observationModel: 'longitudinal',
  },
  role: 'owner',
  permissions: { canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true, canExportData: true, canManageAccess: true },
  templateName: 'Neurotraumatologie (fictif)', versionNumber: 3, currentUserId: profile.id,
} as BaseListing;

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'type' | 'scope'>): TemplateField {
  return {
    id: p.fieldKey, section: 'demographie', unit: null, allowedValues: null, required: false,
    minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...p,
  };
}
const sections: TemplateSection[] = [
  { id: 's1', sectionKey: 'demographie', label: 'Démographie', displayOrder: 0 },
  { id: 's2', sectionKey: 'circonstances', label: 'Circonstances du traumatisme', displayOrder: 1 },
  { id: 's3', sectionKey: 'examen', label: 'Examen initial', displayOrder: 2 },
  { id: 's4', sectionKey: 'imagerie', label: 'Imagerie', displayOrder: 3 },
  { id: 's5', sectionKey: 'diagnostic', label: 'Diagnostic', displayOrder: 4 },
];
const option = (valueKey: string, label: string) => ({ valueKey, label, isActive: true });
const yesNo = [option('oui', 'Oui'), option('non', 'Non')];
const choice = (fieldKey: string, label: string, section: string, displayOrder: number, scope: 'patient' | 'encounter' = 'patient') =>
  field({ fieldKey, label, scope, type: 'select', allowedValues: ['oui', 'non'], allowedOptions: yesNo, section, displayOrder });
const fields: TemplateField[] = [
  field({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['f', 'm'], allowedOptions: [option('f', 'Féminin'), option('m', 'Masculin')], displayOrder: 0 }),
  field({ fieldKey: 'localite', label: 'Localité / quartier', scope: 'patient', type: 'text', displayOrder: 1 }),
  field({ fieldKey: 'profession', label: 'Profession', scope: 'patient', type: 'text', displayOrder: 2 }),
  field({ fieldKey: 'mecanisme', label: 'Mécanisme', scope: 'patient', type: 'text', section: 'circonstances', displayOrder: 3 }),
  choice('pci', 'Perte de connaissance initiale', 'circonstances', 4),
  choice('amnesie', 'Amnésie post-traumatique', 'circonstances', 5),
  choice('vomissements', 'Vomissements', 'circonstances', 6),
  choice('convulsions', 'Convulsions post-traumatiques', 'circonstances', 7),
  // Revue post-optimisation (C4) : champs CIM-11, comme « Diagnostics a coder » les annonce.
  field({ fieldKey: 'diagnostic', label: 'Diagnostic principal', scope: 'patient', type: 'terminology', section: 'diagnostic', displayOrder: 8 }),
  field({ fieldKey: 'glasgow', label: 'Score de Glasgow', scope: 'encounter', type: 'integer', section: 'examen', required: true, minValue: 3, maxValue: 15, displayOrder: 10 }),
  choice('pupilles', 'Pupilles réactives', 'examen', 11, 'encounter'),
  choice('deficit', 'Déficit moteur', 'examen', 12, 'encounter'),
  { ...choice('scanner', 'Scanner réalisé', 'imagerie', 13, 'encounter'), required: true },
  field({ fieldKey: 'lesion', label: 'Lésion principale', scope: 'encounter', type: 'text', section: 'imagerie', displayOrder: 14 }),
  field({ fieldKey: 'diagnostics', label: 'Diagnostics associés', scope: 'encounter', type: 'terminology', isMultiple: true, section: 'diagnostic', displayOrder: 15 }),
];
const version = { id: 'v1', templateId: 't1', versionNumber: 3, status: 'published' as const };

// --- Dossiers fictifs -------------------------------------------------------------------
const row = (n: number, sexe: string, localite: string, validationStatus: string): PatientListItem => ({
  id: `p${n}`, code: `P-${String(n).padStart(4, '0')}`, templateVersionId: 'v1', version: 1,
  data: { sexe, localite, mecanisme: 'Chute de sa hauteur', pci: 'oui' }, validationStatus, identity: null,
});
const rows = [row(1, 'f', 'Farcha', 'draft'), row(2, 'f', 'Farcha', 'complete'), row(3, 'm', 'Chagoua', 'complete')];
// Revue post-optimisation (C4) : diagnostics FICTIFS (codes « FIC »), ceux que « Diagnostics a
// coder » annonce. Le principal est une proposition a confirmer ; la rencontre e2 porte un
// diagnostic confirme, puis un texte que le codage n'a pas su rattacher (rang 2).
const coding = (status: 'suggested' | 'confirmed' | 'unmatched', normalized: string, score?: number) =>
  ({ method: 'ai_assisted' as const, status, normalized, release: 'cim11-fictive', language: 'fr', ...(score === undefined ? {} : { score }) });
const patient: PatientListItem = {
  ...rows[0], version: 3, updatedAt: '2026-09-01T10:00:00Z', createdBy: profile.id,
  data: {
    ...rows[0].data,
    diagnostic: { code: 'FIC.21', label: 'Hémorragie sousdurale non traumatique', raw: 'HSD chronique droit (fictif)', coding: coding('suggested', 'hsd chronique droit', 0.81) },
  },
  identity: { fullName: 'Awa Démo (fictive)', dateOfBirth: '2014-02-18', phone: null, address: null, externalIdentifier: null },
};
const encounters: Encounter[] = [
  { id: 'e1', encounterType: 'consultation', encounterDate: '2026-08-21', validationStatus: 'complete', ageValue: 12, ageUnit: 'years',
    data: { glasgow: 14, pupilles: 'oui', scanner: 'oui', lesion: 'Hématome extradural' }, updatedAt: '2026-08-21T09:00:00Z', templateVersionId: 'v1' },
  { id: 'e2', encounterType: 'consultation', encounterDate: '2026-09-12', validationStatus: 'draft', ageValue: 12, ageUnit: 'years',
    data: { glasgow: 15, scanner: 'non', diagnostics: [
      { code: 'FIC.10', label: 'Commotion cérébrale', raw: 'commotion (fictif)', coding: coding('confirmed', 'commotion', 0.95) },
      { raw: 'Céphalées post-traumatiques atypiques (fictif)', coding: coding('unmatched', 'céphalées post-traumatiques atypiques') },
    ] }, updatedAt: '2026-09-12T09:00:00Z', templateVersionId: 'v1' },
];

// --- Analyse et gestion : journal, cohortes, exports, missions, file a completer ---------
const at = (day: number, hour = 9) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
// `actorIsSelf` vient du serveur (lot 4) : « Vous » pour la personne connectee, le nom sinon.
const activity: ActivityEvent[] = [
  { id: 'a1', at: at(26, 16), action: 'export_created', actorName: profile.fullName, actorIsSelf: true, metadata: { format: 'csv' } },
  { id: 'a6', at: at(26, 10), action: 'patient_deleted', actorName: 'Dr Collègue (fictive)', actorIsSelf: false, metadata: { reason: 'Doublon fictif' } },
  { id: 'a2', at: at(25, 11), action: 'access_granted', actorName: profile.fullName, actorIsSelf: true, metadata: null },
  { id: 'a3', at: at(24, 10), action: 'patient_deleted', actorName: profile.fullName, actorIsSelf: true, metadata: { reason: 'Doublon fictif' } },
  { id: 'a4', at: at(22, 15), action: 'data_imported', actorName: profile.fullName, actorIsSelf: true, metadata: null },
  { id: 'a5', at: at(20, 9), action: 'template_published', actorName: profile.fullName, actorIsSelf: true, metadata: null },
];
const cohorts: CohortSummary[] = [
  { id: 'c1', name: 'Glasgow ≤ 12 (fictive)', cohortType: 'snapshot', snapshotAt: at(18), memberCount: 1,
    filterDefinition: { conditions: [] }, validatedOnly: true },
  { id: 'c2', name: 'Enfants de moins de 15 ans (fictive)', cohortType: 'snapshot', snapshotAt: at(12), memberCount: 2,
    filterDefinition: { conditions: [] }, validatedOnly: true },
  { id: 'c3', name: 'Suivi des Glasgow ≤ 8 (fictive)', cohortType: 'dynamic', snapshotAt: null, memberCount: 0,
    filterDefinition: { conditions: [{ scope: 'encounter', field: 'glasgow', op: 'lte', value: 8 }] }, validatedOnly: false },
];
const exportLog: ExportLogItem[] = [1, 2, 3, 4].map((n) => ({
  id: `x${n}`, format: n % 2 ? 'csv' : 'xlsx', exportedAt: at(20 + n, 14), patientCount: 3, encounterCount: 2,
  fileHash: `${String(n).repeat(8)}${'a'.repeat(56)}`, storedFilePath: null, generationMode: 'server', profile: 'analysis',
}));
// Lot 8 : la mission 1 arrive a echeance dans neuf jours, pour la page « A faire ».
const soon = new Date(Date.now() + 9 * 86_400_000).toISOString();
const mission = (n: number, revokedAt: string | null): MissionAccount => ({
  accessId: `m${n}`, baseId: 'b1', baseName: listing.base.name, userId: `u-mission-${n}`,
  accountLabel: `Enquêteur ${n} (fictif)`, loginIdentifier: `enqueteur-${n}`, expiresAt: n === 1 ? soon : '2027-03-31T00:00:00Z',
  revokedAt, createdAt: at(n), canViewIdentity: false, identityJustification: null,
  credentialStatus: revokedAt ? 'revoked' : 'active', credentialGeneration: 1, lastRotatedAt: null,
});
const missions = [mission(1, null), mission(2, at(10)), mission(3, at(14))];
const editorPermissions = { ...listing.permissions, canViewIdentity: false, canExportData: false, canManageAccess: false };
const members: AccessItem[] = [
  { id: 'ac1', userId: 'u-2', fullName: 'Dr Collègue (fictive)', role: 'editor', permissions: editorPermissions },
  { id: 'ac2', userId: 'u-3', fullName: 'Interne Démo (fictif)', role: 'viewer', permissions: { ...editorPermissions, canEditStructuredData: false } },
];
const completion: CompletionItem[] = [
  { kind: 'patient', patientId: 'p1', code: 'P-0001', status: 'draft', missing: ['Profession', 'Amnésie post-traumatique'] },
  { kind: 'encounter', patientId: 'p1', encounterId: 'e2', code: 'P-0001', encounterType: 'consultation', encounterDate: '2026-09-12', status: 'draft', missing: ['Pupilles réactives'] },
];
// Lot 8 : brouillons serveur a reprendre (metadonnees seules, comme list_my_work_drafts).
const serverDrafts: WorkDraftSummary[] = [
  { id: 'd1', baseId: 'b1', kind: 'encounter_create', targetId: 'p1', patientId: 'p1', patientCode: 'P-0001', updatedAt: at(28, 8), expiresAt: at(29, 8) },
  { id: 'd2', baseId: 'b1', kind: 'patient_create', targetId: null, patientId: null, patientCode: null, updatedAt: at(27, 17), expiresAt: at(28, 17) },
];
// Formulaires de saisie courts (Parametres › Saisies) : « Sortie » cite une variable retiree
// de la base depuis, que l'ecran doit compter sans jamais afficher sa cle.
let entryFormRows: EntryForm[] = [
  { id: 'ef1', baseId: 'b1', name: 'Admission (fictif)', fieldKeys: ['sexe', 'localite', 'mecanisme', 'pci'], requiredKeys: ['sexe'], rowVersion: 1, updatedAt: at(26) },
  { id: 'ef2', baseId: 'b1', name: 'Sortie (fictif)', fieldKeys: ['amnesie', 'profession', 'ancienne_variable'], requiredKeys: [], rowVersion: 1, updatedAt: at(27) },
];
const entryForms = strict<EntryFormRepository>('entryForms', {
  async list(baseId: string) { return entryFormRows.filter((form) => form.baseId === baseId); },
  async create(baseId: string, input: EntryFormInput) {
    const created: EntryForm = { id: `ef${entryFormRows.length + 1}`, baseId, ...input, rowVersion: 1, updatedAt: new Date().toISOString() };
    entryFormRows = [...entryFormRows, created];
    return created;
  },
  async update(id: string, _expectedVersion: number, input: EntryFormInput) {
    entryFormRows = entryFormRows.map((form) => (form.id === id ? { ...form, ...input, rowVersion: form.rowVersion + 1 } : form));
    return entryFormRows.find((form) => form.id === id)!;
  },
  async remove(id: string) { entryFormRows = entryFormRows.filter((form) => form.id !== id); },
});

// Revue post-optimisation (C4) : nomenclature CIM-11 FICTIVE. Le codage assiste repond apres un
// court delai, comme le vrai service : l'ecran doit annoncer l'analyse en cours.
const nomenclature = [
  ['FIC.10', 'Commotion cérébrale'],
  ['FIC.11', 'Contusion cérébrale'],
  ['FIC.21', 'Hémorragie sousdurale non traumatique'],
  ['FIC.22', 'Hématome sous-dural traumatique'],
  ['FIC.23', 'Hématome extradural'],
  ['FIC.30', 'Céphalée post-traumatique aiguë'],
  ['FIC.31', 'Céphalée post-traumatique persistante'],
].map(([code, label]) => ({ code, label, searchText: normalizeQuery(label) }));
const release = { id: 'r-cim11-fictive', slug: 'cim11-fictive', version: '2026 (fictive)', conceptCount: nomenclature.length };
const concept = (code: string, score: number): CodedConcept => {
  const { label } = nomenclature.find((entry) => entry.code === code)!;
  return { code, label, uri: null, score };
};
const terminology = strict<TerminologyRepository>('terminology', {
  async search(query: string) {
    const needle = normalizeQuery(query.trim());
    return nomenclature.filter((entry) => entry.searchText.includes(needle))
      .map(({ code, label }) => ({ id: code, code, label, kind: 'category', depth: 1 }));
  },
  async activeRelease() { return release; },
  async listEntries(_releaseId: string, offset: number, limit: number) {
    return { entries: nomenclature.slice(offset, offset + limit), total: nomenclature.length };
  },
  async codeText(text: string): Promise<TerminologyCodingResult> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const normalized = text.replace(/\(fictif\)/gi, '').trim().toLocaleLowerCase('fr');
    const item: CodedDiagnosis = /céphal/.test(normalized)
      ? { normalized, status: 'ambiguous', score: 0.6, best: null, alternatives: [concept('FIC.30', 0.6), concept('FIC.31', 0.58)] }
      : /hsd|sous-?dural/.test(normalized)
        ? { normalized, status: 'suggested', score: 0.81, best: concept('FIC.21', 0.81), alternatives: [concept('FIC.22', 0.7)] }
        : /commotion/.test(normalized)
          ? { normalized, status: 'automatic', score: 0.95, best: concept('FIC.10', 0.95), alternatives: [] }
          : { normalized, status: 'unmatched', score: 0, best: null, alternatives: [] };
    return { method: 'ai_assisted', release: release.slug, language: 'fr', items: [item] };
  },
});

// --- Depots en memoire ------------------------------------------------------------------
const bases = strict<BaseRepository>('bases', {
  async listMyBases() { return [listing]; },
  async listDeletedBases() { return []; },
  async getBase(id: string) { return id === listing.base.id ? listing : null; },
  async listTemplateModels() {
    return [{ versionId: 'v1', versionNumber: 3, templateId: 't1', name: 'Neurotraumatologie (fictif)', specialty: 'Neurochirurgie', scope: 'personal' }];
  },
  async getInclusionStats() {
    return { total: rows.length, target: 40, targetDate: '2027-06-30', targetRevision: 1,
      monthly: [{ month: '2026-07', count: 1 }, { month: '2026-08', count: 1 }, { month: '2026-09', count: 1 }] };
  },
  async getCompletenessStats() {
    return fields.map((entry, index) => ({ fieldKey: entry.fieldKey, label: entry.label, scope: entry.scope, filled: index % 3, total: 3 }));
  },
  async getTodoCounts() { return [{ baseId: listing.base.id, incomplete: completion.length, clarifications: 1, pendingCodings: 2 }]; },
  async listPendingCodings() {
    return {
      hasMore: false,
      items: [
        { patientId: 'p1', patientCode: 'P-0001', encounterId: 'e2', encounterType: 'consultation', encounterDate: '2026-09-12',
          fieldKey: 'diagnostics', fieldLabel: 'Diagnostics associés', position: 1, raw: 'Céphalées post-traumatiques atypiques (fictif)',
          proposedLabel: null, status: 'unmatched' as const, updatedAt: '2026-09-28T09:00:00Z' },
        { patientId: 'p1', patientCode: 'P-0001', encounterId: null, encounterType: null, encounterDate: null,
          fieldKey: 'diagnostic', fieldLabel: 'Diagnostic principal', position: null, raw: 'HSD chronique droit (fictif)',
          proposedLabel: 'Hémorragie sousdurale non traumatique', status: 'suggested' as const, updatedAt: '2026-09-27T16:00:00Z' },
      ],
    };
  },
});
// Lot 6 : l'editeur des jeux de variables s'ouvre depuis « Mes jeux de variables » sur un
// brouillon charge — la fixture fictive de 216 variables, 24 sections et 26 regles.
const registry = createEditorRegistryRepository();
// 5.13-B : douze regles d'affichage reprennent la condition d'une regle existante, comme
// « intervention chirurgicale réalisée = oui » dans l'audit. L'editeur les regroupe en une
// ligne, des le premier ecran ; elles restent unitaires.
for (const target of [
  ...Array.from({ length: 9 }, (_, index) => `bloc_02_a_variable_0${index + 1}`),
  'bloc_02_b_variable_01', 'bloc_02_b_variable_02', 'bloc_02_b_variable_03',
]) {
  void registry.addRule(editorRegistryVersion.id, {
    if: { field: 'bloc_01_direct_04', operator: 'equals', value: 'oui' },
    then: { field: target, operator: 'visible' },
  }, '', 'block');
}
// Revue post-optimisation (C5) : trois groupes repetables pour l'onglet Sections, aux libelles
// de saisie nommes, reduits au nom d'un element, ou par defaut.
for (const [sectionKey, label, addLabel, itemLabel] of [
  ['suivi_consultations', 'Consultations de suivi (fictif)', 'Ajouter une consultation', 'Consultation'],
  ['suivi_lesions', 'Lésions (fictif)', null, 'Lésion'],
  ['suivi_prelevements', 'Prélèvements (fictif)', null, null],
] as const) {
  void registry.addSection!(editorRegistryVersion.id, sectionKey, label, null).then(async (section) => {
    await registry.setSectionRepeatable!(section.id, true);
    await registry.setSectionRepeatLabels!(section.id, addLabel, itemLabel);
  });
}
const templates = strict<TemplateRepository>('templates', {
  // Comme le vrai depot : chaque variable porte le libelle et le rang de sa section.
  async getVersion(id: string) {
    if (id === editorRegistryVersion.id) return registry.getVersion(id);
    return { version, fields: withSections(fields, sections), rules: [], sections };
  },
  async getSections() { return sections; },
  async listTemplates() {
    return [
      { id: 't1', name: 'Neurotraumatologie (fictif)', specialty: 'Neurochirurgie', ownerUserId: profile.id, versions: [version] },
      { id: editorRegistryVersion.templateId, name: 'Registre multipathologies (fictif)', specialty: 'Neurologie',
        ownerUserId: profile.id, versions: [editorRegistryVersion] },
    ];
  },
  // Methodes facultatives du contrat : absentes, l'ecran prend son chemin de repli documente.
  getFields: undefined,
});
const patients = strict<PatientRepository>('patients', {
  async listPatients() { return rows; },
  async listPatientsPage() { return { rows, total: rows.length }; },
  async searchPatientIdsByIdentity() { return { ids: [], total: 0 }; },
  // Comme le vrai depot depuis le lot 8 : la fiche arrive sans identite, lue au toucher.
  async getPatient(_baseId: string, id: string) { return id === patient.id ? { ...patient, identity: null } : null; },
  async getPatientIdentity(id: string) { return id === patient.id ? patient.identity : null; },
  async listEncounters() { return encounters; },
  async getEncounter(id: string) { return encounters.find((entry) => entry.id === id) ?? null; },
  async computeAge() { return 12; },
  async listFieldChanges() { return []; },
  async findIdentityMatches() { return []; },
  async getCompletionQueuePage(_baseId: string, limit: number, offset: number) {
    return { items: completion, total: completion.length, limit, offset, hasMore: false };
  },
  getPatientFormContext: undefined,
  getEncounterFormContext: undefined,
});

// L'ecran demande est dans le fragment de l'adresse ; `/` (tableau de bord) par defaut.
const router = createMemoryRouter([{ path: '*', element: <AppRoutes /> }], {
  initialEntries: [decodeURIComponent(window.location.hash.slice(1)) || '/'],
});

function Harness() {
  return (
    <I18nProvider>
      <ErrorBoundary>
        <AuthContext.Provider value={auth}>
          <RepositoryProvider
            bases={bases}
            templates={templates}
            patients={patients}
            attachments={strict('attachments', { async listAttachments() { return []; } })}
            cohorts={strict<CohortRepository>('cohorts', {
              async listCohorts() { return cohorts; },
              async preview() { return { patientCount: 1, encounterCount: 2 }; },
            })}
            exports={strict<ExportRepository>('exports', { async listBaseExports() { return exportLog; } })}
            access={strict<AccessRepository>('access', {
              async listInvitations() {
                return [{ id: 'i1', email: 'collegue@exemple.test', role: 'editor', permissions: editorPermissions, status: 'pending', expiresAt: '2026-10-04T00:00:00Z' }];
              },
              async listAccess() { return members; },
              async getIdentityAudit() {
                return { byReader: [{ readerName: profile.fullName, count: 3, lastAt: at(26) }],
                  reads: [26, 25, 24].map((day) => ({ at: at(day), readerName: profile.fullName, patientCode: 'P-0001' })) };
              },
            })}
            curation={strict('curation', {})}
            admin={strict('admin', {})}
            audit={strict<AuditRepository>('audit', {
              async getBaseActivity() { return activity; },
              async logIdentityRead() { /* memoire seule */ },
            })}
            groups={strict('groups', {})}
            terminology={terminology}
            missions={strict<MissionRepository>('missions', { async list() { return missions; } })}
            clientErrors={strict('clientErrors', {})}
            workDrafts={strict('workDrafts', { available: false, async listMine() { return serverDrafts; } })}
            formPreparations={strict('formPreparations', {
              // Parametres › Formulaire (lot 5) : l'accueil et l'edition, sur une definition vide.
              available: true,
              async openOrResume(baseId: string) {
                return {
                  preparation: null, persisted: false,
                  context: {
                    baseId, sourceTemplateVersionId: 'v1', sourceRevision: 4, sourceFingerprint: `sha256:${'b'.repeat(64)}`,
                    definition: { sections: [], commonGroups: [], fields: [], rules: [], diagnosisConfiguration: null },
                  },
                };
              },
            })}
            entryForms={entryForms}
            viewPreferences={strict('viewPreferences', {
              async getVisiblePatientFieldKeys() { return ['sexe', 'localite', 'mecanisme']; },
              async saveVisiblePatientFieldKeys() { /* memoire seule */ },
            })}
          >
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </RepositoryProvider>
        </AuthContext.Provider>
      </ErrorBoundary>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
