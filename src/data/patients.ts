// Couche d'acces aux donnees "patients" (cahier §4, §8.5).
// La separation identite/analytique est garantie cote base (RLS) : si l'utilisateur
// n'a pas l'acces identite, la liste des identites revient vide et seul le code
// (zone analytique) est visible.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { ImportRow, ImportReport } from '../domain/import';
import type { RawSnapshotData } from './offline';

/** Options d'un import (statut cible, mode de conflit, empreinte fichier, version vue a l'apercu). */
export interface ImportOptions {
  dryRun: boolean;
  status: string;
  conflict: 'fill' | 'overwrite' | 'skip';
  fileHash?: string | null;
  templateVersionId?: string | null;
  /** Lot d'import en cours (import par chunks) ; null = appel autonome. */
  batchId?: string | null;
}

/** Parametres d'ouverture d'un lot d'import (import par chunks). */
export interface BeginImportOptions {
  status: string;
  conflict: 'fill' | 'overwrite' | 'skip';
  fileHash?: string | null;
  templateVersionId?: string | null;
  /** Nombre total de lignes annonce (§7.4 : controle de completude a la cloture du lot). */
  expectedRows?: number | null;
}

/** Etat serveur d'un lot: seule source de verite pour reprendre un import chunké. */
export interface ImportBatchState {
  batch_id: string;
  status: string;
  resume_state?: 'modern' | 'historical_unsafe' | 'historical_cancelled' | 'replacement';
  replaces_batch_id?: string | null;
  expected_rows: number | null;
  row_count: number;
  error_count: number;
  succeeded_source_rows: number[];
  rejected_source_rows: number[];
}

export interface PatientIdentityInfo {
  fullName: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  address: string | null;
  externalIdentifier: string | null;
}

export interface PatientListItem {
  id: string;
  code: string;
  templateVersionId: string;
  data: Record<string, unknown>;
  validationStatus: string;
  /** Version optimiste des donnees permanentes. */
  version?: number | null;
  updatedAt?: string | null;
  /** Auteur serveur de la fiche, requis pour limiter la correction d'identite du saisisseur. */
  createdBy?: string | null;
  identity: PatientIdentityInfo | null; // null si pas d'acces identite
}

export interface NewPatientInput {
  /** Code legacy explicite (replay hors-ligne); les parcours en ligne le laissent vide. */
  code?: string;
  fullName: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  address: string | null;
  externalIdentifier: string | null;
  permanentData: Record<string, unknown>;
}

/** §7.6 — Rencontre du fichier ressemblant a une rencontre DEJA enregistree (avertissement). */
export interface ImportDuplicateWarning {
  row: number;
  patientCode: string;
  encounterDate: string;
  encounterType: string;
}

/** Doublon potentiel : un patient existant au MEME nom complet + date de naissance. */
export interface IdentityMatch {
  patientId: string;
  code: string;
  fullName: string | null;
  dateOfBirth: string | null;
}

export interface NewEncounterInput {
  encounterType: string;
  /** L66 §4.3 : nulle pour une OCCURRENCE de groupe repetable, jamais pour une vraie rencontre. */
  encounterDate: string | null;
  validationStatus: string;
  ageUnit: string;
  data: Record<string, unknown>;
  /**
   * L68 — bloc repetable auquel cette ligne appartient. Absent = rencontre ordinaire,
   * comportement inchange. Le serveur impose alors `encounter_type = 'autre'` et refuse
   * un bloc inconnu, non racine ou non repetable.
   */
  groupSectionKey?: string | null;
}

/** Rejeu idempotent d'une creation patient preparee hors-ligne (feuille de route O1). */
export interface ReplayPatientCreateInput extends NewPatientInput {
  operationKey: string;
}

/** Rejeu idempotent d'une creation rencontre hors-ligne : le patient est designe soit
 * par la cle d'operation parente (patient en attente), soit par son UUID serveur. */
export interface ReplayEncounterCreateInput extends Omit<NewEncounterInput, 'encounterDate'> {
  operationKey: string;
  parentOperationKey: string | null;
  patientId: string | null;
  /** Null seulement dans une occurrence de groupe : une vraie rencontre reste datee (§4.3). */
  encounterDate: string | null;
  /** L71 : bloc repetable de l'occurrence ; null pour une rencontre ordinaire. */
  groupSectionKey?: string | null;
}

export interface Encounter {
  id: string;
  encounterType: string;
  /** Nulle pour une occurrence de groupe non datee (L66 §4.3). */
  encounterDate: string | null;
  validationStatus: string;
  ageValue: number | null;
  ageUnit: string | null;
  data: Record<string, unknown>;
  /** Version optimiste (cote serveur) : sert au verrou de synchronisation hors-ligne. */
  updatedAt?: string | null;
  /** §7.4 — version de gabarit DE LA RENCONTRE : l'edition historique charge CE dictionnaire. */
  templateVersionId?: string | null;
  /** Section répétable persistée. Undefined dans une réponse/cache ancien sans ce marqueur. */
  groupSectionKey?: string | null;
}

/** Etats d'une valeur dans le contexte serveur d'une fiche E3. */
export type RecordFormKind = 'patient' | 'encounter';
export type RecordFormOrigin = 'initial' | 'completion' | 'correction' | 'import' | 'offline_replay';
export type RecordFormValueState = 'empty' | 'present' | 'explicit_missing' | 'not_applicable';
export type RecordFormDefinitionState = 'defined' | 'not_defined';

export interface RecordFormProvenance {
  origin: RecordFormOrigin;
  captured_by: string | null;
  captured_at: string | null;
  definition_revision: string;
  operation_id: string | null;
}

export interface RecordFormFieldContext {
  field_key: string;
  definition_revision: string;
  active_definition_revision: string;
  scope: RecordFormKind;
  definition_state: RecordFormDefinitionState;
  applicability: 'applicable' | 'not_applicable';
  applicability_reason: string;
  /** Distingue le filtrage des champs hors du groupe persistant des autres causes de non-applicabilite. */
  repeatable_group_applicable?: boolean;
  value_state: RecordFormValueState;
  provenance: RecordFormProvenance | null;
  definition: Record<string, unknown>;
  active_definition: Record<string, unknown> | null;
  value?: unknown;
  missing_code?: string | null;
}

export interface RecordFormObligation {
  field_key: string;
  label: string;
  definition_revision: string;
  reason: 'missing_value' | 'not_defined';
}

export interface RecordFormCompleteness {
  current_missing_field_keys: string[];
  current_missing_count: number;
  current_complete: boolean;
  historical_missing_field_keys: string[];
  historical_missing_count: number;
  historical_complete: boolean;
}

/** Vue calculée par le moteur diagnostique serveur (la forme exacte reste versionnée). */
export type RecordFormDiagnosisCoverage = Record<string, unknown>;

/** Contexte calculé côté serveur et protégé par une empreinte : aucune décision de compatibilité n'est prise par l'UI. */
export interface RecordFormContext {
  record_kind: RecordFormKind;
  record_id: string;
  record_revision: number;
  base_id: string;
  active_revision: number;
  record_definition_revision: string;
  historical_definition: Record<string, unknown>;
  active_definition: Record<string, unknown>;
  fields: RecordFormFieldContext[];
  values: Record<string, unknown>;
  current_obligations: RecordFormObligation[];
  completeness: RecordFormCompleteness;
  diagnosis_coverage: RecordFormDiagnosisCoverage | null;
  validation_status: string;
  encounter_type: string | null;
  context_fingerprint: string;
}

export interface CompatiblePatientUpdateInput {
  baseId: string;
  patientId: string;
  patch: Record<string, unknown>;
  validationStatus: string | null;
  reason: string;
  expectedRecordRevision: number;
  recordDefinitionRevision: string;
  operationId: string;
  contextFingerprint: string;
}

export interface CompatibleEncounterUpdateInput {
  baseId: string;
  encounterId: string;
  patch: Record<string, unknown>;
  validationStatus: string | null;
  reason: string;
  expectedRecordRevision: number;
  recordDefinitionRevision: string;
  operationId: string;
  contextFingerprint: string;
}

export interface CompatibleRecordUpdateReceipt {
  recordKind: RecordFormKind;
  recordId: string;
  recordRevision: number;
  validationStatus: string;
  operationId: string;
  activeRevision: number;
  recordDefinitionRevision: string;
  contextFingerprint: string;
}

/**
 * Construit uniquement le complément explicite d'un écran. Les champs masqués restent hors
 * patch ; une absence historique ne devient jamais une suppression implicite.
 */
export function buildCompatiblePatch(
  initial: Record<string, unknown>,
  current: Record<string, unknown>,
  hiddenKeys: ReadonlySet<string>,
  editableKeys: readonly string[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const has = (object: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(object, key);
  const same = (left: unknown, right: unknown) => {
    if (Object.is(left, right)) return true;
    try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
  };

  for (const key of editableKeys) {
    if (hiddenKeys.has(key)) continue;
    const wasPresent = has(initial, key);
    const isPresent = has(current, key);
    if (!isPresent) {
      // A previously stored value can be cleared deliberately. `null` keeps the JSON key
      // and lets the server apply the field's normal empty-value semantics.
      if (wasPresent) patch[key] = null;
      continue;
    }
    if (!wasPresent || !same(initial[key], current[key])) patch[key] = current[key];
  }
  return patch;
}

export interface FieldChange {
  fieldKey: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  changedAt: string;
}

/** B2 — un dossier NON FINALISE avec ses champs requis manquants (file « a completer »). */
export interface CompletionItem {
  kind: 'patient' | 'encounter';
  patientId: string;
  encounterId?: string;
  code: string;
  encounterType?: string;
  encounterDate?: string;
  status: string;
  missing: string[];
}

export interface CompletionQueuePage {
  items: CompletionItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface PatientRepository {
  listPatients(baseId: string): Promise<PatientListItem[]>;
  /** Page de patients (pagination serveur) + effectif total de la base, filtre et tri compris. */
  listPatientsPage(
    baseId: string, limit: number, offset: number, options?: PatientListQuery,
  ): Promise<{ rows: PatientListItem[]; total: number }>;
  /**
   * UX-12(c) — identifiants des patients de cette base dont le NOM correspond au terme.
   *
   * Le serveur vérifie le rôle et la permission d'identité sur cette base, journalise l'accès
   * sans le terme, et ne rend que des identifiants : aucun nom ne traverse cette frontière.
   * Absente quand le serveur ignore encore l'opération ; l'écran garde alors la recherche par
   * code et annonce l'indisponibilité, au lieu d'émettre une requête qui échouerait.
   */
  searchPatientIdsByIdentity?(
    baseId: string, term: string, limit: number, offset: number,
  ): Promise<{ ids: string[]; total: number }>;
  /** §8 — Instantane ANALYTIQUE complet (patients + rencontres + champs) en UN appel (hors-ligne). */
  fetchBaseSnapshot(baseId: string): Promise<RawSnapshotData | null>;
  /** §7.6 — Avertit (a l'apercu) des rencontres ressemblant a des rencontres deja enregistrees. */
  detectImportDuplicates(baseId: string, rows: ImportRow[]): Promise<ImportDuplicateWarning[]>;
  /** Recherche un doublon potentiel par identite (nom + date de naissance). [] si rien. */
  findIdentityMatches(baseId: string, fullName: string, dateOfBirth: string): Promise<IdentityMatch[]>;
  createPatient(baseId: string, input: NewPatientInput): Promise<{ id: string; code: string }>;
  /** Rejeu IDEMPOTENT d'une creation hors-ligne : une meme cle + charge ne cree jamais deux fois. */
  replayPatientCreate(baseId: string, input: ReplayPatientCreateInput): Promise<{ id: string; code: string }>;
  getPatient(baseId: string, patientId: string): Promise<PatientListItem | null>;
  /** E3 : contexte serveur historique + projection active, sans identité. */
  getPatientFormContext?(baseId: string, patientId: string): Promise<RecordFormContext | null>;
  /** Age calcule par le systeme (DOB jamais exposee). null si pas de date de naissance. */
  computeAge(patientId: string, at: string, unit?: string): Promise<number | null>;
  createEncounter(patientId: string, input: NewEncounterInput, operationKey?: string): Promise<{ id: string }>;
  /** Rejeu IDEMPOTENT d'une creation rencontre hors-ligne (dependante du patient parent). */
  replayEncounterCreate(input: ReplayEncounterCreateInput): Promise<{ id: string; patientId: string }>;
  listEncounters(patientId: string): Promise<Encounter[]>;
  getEncounter(encounterId: string): Promise<Encounter | null>;
  /** E3 : contexte serveur historique + projection active, sans identité. */
  getEncounterFormContext?(baseId: string, encounterId: string): Promise<RecordFormContext | null>;
  updateEncounter(
    encounterId: string,
    data: Record<string, unknown>,
    status: string,
    reason: string,
    expectedUpdatedAt?: string | null,
    operationId?: string | null,
  ): Promise<{ id: string }>;
  listFieldChanges(entity: 'patient' | 'encounter', entityId: string): Promise<FieldChange[]>;
  softDeletePatient(patientId: string, reason: string): Promise<void>;
  softDeleteEncounter(encounterId: string, reason: string): Promise<void>;
  /** Finalise les donnees permanentes d'un patient (draft -> curated). Echoue si incompletes. */
  finalizePatient(patientId: string): Promise<void>;
  /** Corrige / complete les donnees PERMANENTES d'un patient (journalise, re-validees). */
  updatePatientData(patientId: string, data: Record<string, unknown>, status: string, reason: string, expectedVersion: number | null): Promise<{ version: number | null; updatedAt: string | null }>;
  /** E3 : complément fusionné côté serveur avec révision et empreinte de contexte. */
  updatePatientCompatible?(input: CompatiblePatientUpdateInput): Promise<CompatibleRecordUpdateReceipt>;
  /** E3 : complément fusionné côté serveur avec révision et empreinte de contexte. */
  updateEncounterCompatible?(input: CompatibleEncounterUpdateInput): Promise<CompatibleRecordUpdateReceipt>;
  /** Corrige la zone identite complete via la RPC dediee, auditee et verrouillee. */
  updatePatientIdentity(patientId: string, identity: PatientIdentityInfo, reason: string, expectedVersion: number | null): Promise<{ version: number | null; updatedAt: string | null }>;
  /** Import par lots (patients + rencontres). dryRun=true -> apercu sans ecriture. */
  importRecords(baseId: string, rows: ImportRow[], opts: ImportOptions): Promise<ImportReport>;
  /** Ouvre un lot d'import (controles globaux + idempotence) ; renvoie l'id du lot pour les chunks. */
  beginImportBatch(baseId: string, opts: BeginImportOptions): Promise<string>;
  getImportBatchState(batchId: string): Promise<ImportBatchState>;
  /** Cloture un lot d'import (apres tous les chunks) -> active l'idempotence du fichier. */
  completeImportBatch(batchId: string): Promise<void>;
  /** Annule un lot d'import en cours (libere le fichier). */
  cancelImportBatch(batchId: string): Promise<void>;
  /** B2 : dossiers non finalises + champs requis manquants (RLS : sans acces -> vide). */
  getCompletionQueue(baseId: string, limit?: number): Promise<CompletionItem[]>;
  /** B2 : version paginee de la file de completion. */
  getCompletionQueuePage(baseId: string, limit: number, offset: number): Promise<CompletionQueuePage>;
}

type PatientRow = {
  id: string; patient_code: string; template_version_id: string; data: Record<string, unknown>; validation_status: string; row_version?: number | null; updated_at?: string | null; created_by?: string | null;
};
/** UX-12(b) : tri de liste. Seules des colonnes ANALYTIQUES sont triables ; le depart
 * d'egalite est toujours explicite, sinon deux pages successives peuvent repeter une ligne. */
export type PatientSortField = 'created_at' | 'patient_code';
export interface PatientListQuery {
  /** Recherche par code patient, appliquee par le serveur AVANT la pagination. */
  codeQuery?: string | null;
  sort?: { field: PatientSortField; direction: 'asc' | 'desc' };
  /**
   * UX-12(c) : restreint la page à ces identifiants, déjà résolus par la recherche nominative
   * auditée. La ligne reste lue par le chemin analytique habituel, sous la RLS : l'identité
   * sert à TROUVER le patient, jamais à le décrire.
   */
  ids?: readonly string[] | null;
}

/** Neutralise les jokers d'un motif LIKE saisi par l'utilisateur : « 10 % » cherche ce texte,
 * il n'ouvre pas la recherche a toute la base. L'echappement par antislash est celui de
 * PostgreSQL, applique par le serveur au motif transmis. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const PATIENT_READ_COLUMNS = 'id, patient_code, template_version_id, data, validation_status, row_version, updated_at';
const LEGACY_PATIENT_READ_COLUMNS = 'id, patient_code, template_version_id, data, validation_status, updated_at';
const PATIENT_DETAIL_READ_COLUMNS = `${PATIENT_READ_COLUMNS}, created_by`;
const LEGACY_PATIENT_DETAIL_READ_COLUMNS = `${LEGACY_PATIENT_READ_COLUMNS}, created_by`;

// Compatibilite de lecture pendant une promotion coordonnee : un schema plus ancien peut ne
// pas encore posseder patient.row_version. Le repli est volontairement etroit afin de ne
// jamais masquer une erreur RLS, reseau ou serveur sous une compatibilite silencieuse.
function isMissingPatientRowVersion(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === '42703'
    && typeof candidate.message === 'string'
    && /\brow_version\b/i.test(candidate.message);
}
function isMissingEncounterGroupSectionKey(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === '42703'
    && typeof candidate.message === 'string'
    && /\bgroup_section_key\b/i.test(candidate.message);
}
type IdentityRow = {
  patient_code: string; full_name: string | null; date_of_birth: string | null; phone: string | null;
  address: string | null; external_identifier: string | null;
};
type IdentityMatchRow = {
  patient_id: string; code: string; full_name: string | null; date_of_birth: string | null;
};
type EncounterRow = {
  id: string; encounter_type: string; encounter_date: string | null; validation_status: string;
  age_value: number | null; age_unit: string | null; data: Record<string, unknown>; updated_at?: string | null;
  template_version_id?: string | null; group_section_key?: string | null;
};
type FieldChangeRow = {
  field_key: string; old_value: unknown; new_value: unknown; reason: string | null; changed_at: string;
};
const mapIdentity = (i: IdentityRow): PatientIdentityInfo => ({
  fullName: i.full_name,
  dateOfBirth: i.date_of_birth,
  phone: i.phone,
  address: i.address,
  externalIdentifier: i.external_identifier,
});
// §5.8 — Element de LISTE pseudonymise : jamais d'identite. Le code (zone analytique) suffit a
// parcourir la base ; le nom n'est revele que sur la FICHE patient (getPatient), ou chaque
// consultation est journalisee. Les listes ne chargent donc aucune identite (rien en masse).
const toListItem = (p: PatientRow): PatientListItem => ({
  id: p.id,
  code: p.patient_code,
  templateVersionId: p.template_version_id,
  data: p.data ?? {},
  validationStatus: p.validation_status,
  version: p.row_version ?? null,
  updatedAt: p.updated_at ?? null,
  createdBy: p.created_by ?? null,
  identity: null,
});
const mapEncounter = (r: EncounterRow): Encounter => ({
  id: r.id,
  encounterType: r.encounter_type,
  encounterDate: r.encounter_date,
  validationStatus: r.validation_status,
  ageValue: r.age_value,
  ageUnit: r.age_unit,
  data: r.data ?? {},
  updatedAt: r.updated_at ?? null,
  templateVersionId: r.template_version_id ?? null,
  ...(Object.prototype.hasOwnProperty.call(r, 'group_section_key') ? { groupSectionKey: r.group_section_key ?? null } : {}),
});

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makePatientRepository(client: SupabaseClient | null): PatientRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return {
      listPatients: fail, listPatientsPage: fail, fetchBaseSnapshot: fail, detectImportDuplicates: fail, findIdentityMatches: fail, createPatient: fail, getPatient: fail, computeAge: fail, createEncounter: fail,
      replayPatientCreate: fail, replayEncounterCreate: fail,
      listEncounters: fail, getEncounter: fail, updateEncounter: fail, listFieldChanges: fail,
      softDeletePatient: fail, softDeleteEncounter: fail, finalizePatient: fail, updatePatientData: fail, importRecords: fail, beginImportBatch: fail,
      updatePatientIdentity: fail,
      getImportBatchState: fail, completeImportBatch: fail, cancelImportBatch: fail, getCompletionQueue: fail, getCompletionQueuePage: fail,
    };
  }

  return {
    async listPatients(baseId) {
      // §5.8 — LISTE PSEUDONYMISEE : on ne requete QUE la zone analytique, jamais patient_identity.
      const query = (columns: string) => client
        .from('patient')
        .select(columns)
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      const current = await query(PATIENT_READ_COLUMNS);
      if (!current.error) return ((current.data ?? []) as unknown as PatientRow[]).map(toListItem);
      if (!isMissingPatientRowVersion(current.error)) throw current.error;
      const legacy = await query(LEGACY_PATIENT_READ_COLUMNS);
      if (legacy.error) throw legacy.error;
      return ((legacy.data ?? []) as unknown as PatientRow[]).map(toListItem);
    },

    async listPatientsPage(baseId, limit, offset, options) {
      // §5.8 — page PSEUDONYMISEE (zone analytique + effectif total) ; aucune identite chargee.
      // UX-12(b) : le filtre par code et le tri sont appliques par le SERVEUR, avant la
      // pagination — un filtre limite aux 20 lignes deja chargees ne trouverait pas un patient
      // situe plus loin. RG-9 : seul le code, donnee analytique, est interroge ici.
      const needle = options?.codeQuery?.trim();
      const sort = options?.sort ?? { field: 'created_at' as PatientSortField, direction: 'asc' as const };
      const query = (columns: string) => {
        let request = client
          .from('patient')
          .select(columns, { count: 'exact' })
          .eq('base_id', baseId)
          .is('deleted_at', null);
        if (needle) request = request.ilike('patient_code', `%${escapeLikePattern(needle)}%`);
        if (options?.ids) request = request.in('id', [...options.ids]);
        return request
          .order(sort.field, { ascending: sort.direction === 'asc' })
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1);
      };
      const current = await query(PATIENT_READ_COLUMNS);
      if (!current.error) {
        const rows = (current.data ?? []) as unknown as PatientRow[];
        return { rows: rows.map(toListItem), total: current.count ?? rows.length };
      }
      if (!isMissingPatientRowVersion(current.error)) throw current.error;
      const legacy = await query(LEGACY_PATIENT_READ_COLUMNS);
      if (legacy.error) throw legacy.error;
      const rows = (legacy.data ?? []) as unknown as PatientRow[];
      return { rows: rows.map(toListItem), total: legacy.count ?? rows.length };
    },

    async searchPatientIdsByIdentity(baseId, term, limit, offset) {
      // RG-9 : la réponse ne contient que des identifiants et un total. Les lignes affichées
      // sont ensuite relues par le chemin analytique habituel, sous la RLS.
      const { data, error } = await client.rpc('search_patient_ids_by_identity', {
        p_base_id: baseId, p_term: term, p_limit: limit, p_offset: offset,
      });
      if (error) throw error;
      const rows = (data ?? []) as { patient_id: string; total: number | string }[];
      return { ids: rows.map((row) => row.patient_id), total: Number(rows[0]?.total ?? 0) };
    },

    async fetchBaseSnapshot(baseId) {
      // §8 : un seul aller-retour serveur (RPC) -> base + champs + patients AVEC leurs rencontres.
      const { data, error } = await client.rpc('download_base_snapshot', { p_base_id: baseId });
      if (error) throw error;
      const d = data as RawSnapshotData | null;
      return d && d.base ? d : null;
    },

    async detectImportDuplicates(baseId, rows) {
      // §7.6 : avertissement (lecture seule) sur les rencontres ressemblant a des existantes.
      const { data, error } = await client.rpc('detect_import_duplicates', { p_base_id: baseId, p_rows: rows });
      if (error) throw error;
      const d = data as { warnings?: { row: number; patient_code: string; encounter_date: string; encounter_type: string }[] } | null;
      return (d?.warnings ?? []).map((w) => ({
        row: w.row, patientCode: w.patient_code, encounterDate: w.encounter_date, encounterType: w.encounter_type,
      }));
    },

    async findIdentityMatches(baseId, fullName, dateOfBirth) {
      const name = fullName.trim();
      if (!name || !dateOfBirth) return [];
      // Acces identite requis ; la RPC audite chaque match avant de renvoyer les champs.
      const { data: rows, error } = await client.rpc('find_identity_matches', {
        p_base_id: baseId,
        p_full_name: name,
        p_date_of_birth: dateOfBirth,
      });
      if (error) throw error;
      return ((rows ?? []) as IdentityMatchRow[])
        .map((r) => ({ patientId: r.patient_id, code: r.code, fullName: r.full_name, dateOfBirth: r.date_of_birth }));
    },

    async createPatient(baseId, input) {
      const { data, error } = await client.rpc('create_patient', {
        p_base_id: baseId,
        p_patient_code: input.code?.trim() || null,
        p_full_name: input.fullName,
        p_date_of_birth: input.dateOfBirth,
        p_phone: input.phone,
        p_address: input.address,
        p_external_identifier: input.externalIdentifier,
        p_permanent_data: input.permanentData,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as PatientRow;
      return { id: row.id, code: row.patient_code };
    },

    async replayPatientCreate(baseId, input) {
      // Meme charge que create_patient + la cle d'operation : la RPC serveur garantit
      // l'idempotence (un rejeu apres une reponse perdue ne cree pas de doublon).
      const { data, error } = await client.rpc('replay_patient_create', {
        p_operation_id: input.operationKey,
        p_base_id: baseId,
        p_patient_code: input.code,
        p_full_name: input.fullName,
        p_date_of_birth: input.dateOfBirth,
        p_phone: input.phone,
        p_address: input.address,
        p_external_identifier: input.externalIdentifier,
        p_permanent_data: input.permanentData,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as PatientRow;
      return { id: row.id, code: row.patient_code };
    },

    async computeAge(patientId, at, unit = 'years') {
      const { data, error } = await client.rpc('patient_age_at', { p_patient_id: patientId, p_at: at, p_unit: unit });
      if (error) throw error;
      return (data as number | null) ?? null;
    },

    async createEncounter(patientId, input, operationKey) {
      const args = {
        p_patient_id: patientId,
        p_encounter_type: input.encounterType,
        p_encounter_date: input.encounterDate,
        p_validation_status: input.validationStatus,
        p_data: input.data,
        p_age_unit: input.ageUnit,
        p_group_section_key: input.groupSectionKey ?? null,
      };
      const { data, error } = operationKey
        ? await client.rpc('create_encounter_idempotent', { p_operation_id: operationKey, ...args })
        : await client.rpc('create_encounter', args);
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { id: string };
      return { id: row.id };
    },

    async replayEncounterCreate(input) {
      // La RPC serveur resout le parent : cle d'operation du patient en attente, ou
      // UUID serveur direct ; elle garantit l'ordre et l'idempotence.
      const { data, error } = await client.rpc('replay_encounter_create', {
        p_operation_id: input.operationKey,
        p_parent_operation_id: input.parentOperationKey,
        p_patient_id: input.patientId,
        p_encounter_type: input.encounterType,
        p_encounter_date: input.encounterDate,
        p_validation_status: input.validationStatus,
        p_data: input.data,
        p_age_unit: input.ageUnit,
        p_group_section_key: input.groupSectionKey ?? null,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { id: string; patient_id: string };
      return { id: row.id, patientId: row.patient_id };
    },

    async getPatient(baseId, patientId) {
      const query = (columns: string) => client
        .from('patient')
        .select(columns)
        .eq('id', patientId)
        .eq('base_id', baseId)
        .is('deleted_at', null)
        .maybeSingle();
      const current = await query(PATIENT_DETAIL_READ_COLUMNS);
      const resolved = current.error && isMissingPatientRowVersion(current.error)
        ? await query(LEGACY_PATIENT_DETAIL_READ_COLUMNS)
        : current;
      if (resolved.error) throw resolved.error;
      const p = resolved.data;
      if (!p) return null;
      const row = p as unknown as PatientRow;
      // La zone identite n'est jamais lue en direct : la RPC verifie l'acces et audite
      // avant de renvoyer les champs. Sans acces identite, elle renvoie simplement [].
      const { data: identRows, error: e2 } = await client.rpc('get_patient_identity', { p_patient_id: patientId });
      if (e2) throw e2;
      const i = (((identRows ?? []) as IdentityRow[])[0]) ?? null;
      return {
        ...toListItem(row),
        identity: i ? mapIdentity(i) : null,
      };
    },

    async getPatientFormContext(baseId, patientId) {
      const { data, error } = await client.rpc('read_patient_form_context', {
        p_base_id: baseId,
        p_patient_id: patientId,
      });
      if (error) throw error;
      return (data as RecordFormContext | null) ?? null;
    },

    async listEncounters(patientId) {
      const query = (columns: string) => client
        .from('encounter')
        .select(columns)
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('encounter_date', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      const current = await query('id, encounter_type, encounter_date, validation_status, age_value, age_unit, data, updated_at, template_version_id, group_section_key');
      if (!current.error) return ((current.data ?? []) as unknown as EncounterRow[]).map(mapEncounter);
      if (!isMissingEncounterGroupSectionKey(current.error)) throw current.error;
      // Une réponse sans la colonne reste lisible en ligne, mais n'affirme pas que la rencontre
      // est ordinaire. Seul un null réellement renvoyé par un schéma à jour autorise l'édition hors-ligne.
      const legacy = await query('id, encounter_type, encounter_date, validation_status, age_value, age_unit, data, updated_at, template_version_id');
      if (legacy.error) throw legacy.error;
        return ((legacy.data ?? []) as unknown as EncounterRow[]).map(mapEncounter);
    },

    async getEncounter(encounterId) {
      const { data, error } = await client
        .from('encounter')
        .select('id, encounter_type, encounter_date, validation_status, age_value, age_unit, data, updated_at, template_version_id, group_section_key')
        .eq('id', encounterId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      return data ? mapEncounter(data as EncounterRow) : null;
    },

    async getEncounterFormContext(baseId, encounterId) {
      const { data, error } = await client.rpc('read_encounter_form_context', {
        p_base_id: baseId,
        p_encounter_id: encounterId,
      });
      if (error) throw error;
      return (data as RecordFormContext | null) ?? null;
    },

    async updateEncounter(encounterId, data, status, reason, expectedUpdatedAt, operationId) {
      const { data: row, error } = operationId
        ? await client.rpc('replay_encounter_update', {
          p_operation_id: operationId,
          p_encounter_id: encounterId,
          p_data: data,
          p_validation_status: status,
          p_reason: reason,
          p_expected_updated_at: expectedUpdatedAt ?? null,
        })
        : await client.rpc('update_encounter', {
          p_encounter_id: encounterId,
          p_data: data,
          p_validation_status: status,
          p_reason: reason,
          p_expected_updated_at: expectedUpdatedAt ?? null,
        });
      if (error) throw error;
      const r = (Array.isArray(row) ? row[0] : row) as { id: string };
      return { id: r.id };
    },

    async listFieldChanges(entity, entityId) {
      const { data, error } = await client
        .from('field_change_log')
        .select('field_key, old_value, new_value, reason, changed_at')
        .eq('entity', entity)
        .eq('entity_id', entityId)
        .order('changed_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as FieldChangeRow[]).map((c) => ({
        fieldKey: c.field_key,
        oldValue: c.old_value,
        newValue: c.new_value,
        reason: c.reason,
        changedAt: c.changed_at,
      }));
    },

    async softDeletePatient(patientId, reason) {
      const { error } = await client.rpc('soft_delete_patient', { p_patient_id: patientId, p_reason: reason });
      if (error) throw error;
    },

    async softDeleteEncounter(encounterId, reason) {
      const { error } = await client.rpc('soft_delete_encounter', { p_encounter_id: encounterId, p_reason: reason });
      if (error) throw error;
    },

    async finalizePatient(patientId) {
      const { error } = await client.rpc('finalize_patient', { p_patient_id: patientId });
      if (error) throw error;
    },

    async updatePatientData(patientId, data, status, reason, expectedVersion) {
      const { data: row, error } = await client.rpc('update_patient', {
        p_patient_id: patientId, p_data: data, p_validation_status: status, p_reason: reason,
        p_expected_version: expectedVersion,
      });
      if (error) throw error;
      const r = (Array.isArray(row) ? row[0] : row) as PatientRow;
      return { version: r.row_version ?? null, updatedAt: r.updated_at ?? null };
    },

    async updatePatientCompatible(input) {
      const { data, error } = await client.rpc('update_patient_compatible', {
        p_base_id: input.baseId,
        p_patient_id: input.patientId,
        p_patch: input.patch,
        p_validation_status: input.validationStatus,
        p_reason: input.reason,
        p_expected_record_revision: input.expectedRecordRevision,
        p_record_definition_revision: input.recordDefinitionRevision,
        p_operation_id: input.operationId,
        p_context_fingerprint: input.contextFingerprint,
      });
      if (error) throw error;
      return data as CompatibleRecordUpdateReceipt;
    },

    async updateEncounterCompatible(input) {
      const { data, error } = await client.rpc('update_encounter_compatible', {
        p_base_id: input.baseId,
        p_encounter_id: input.encounterId,
        p_patch: input.patch,
        p_validation_status: input.validationStatus,
        p_reason: input.reason,
        p_expected_record_revision: input.expectedRecordRevision,
        p_record_definition_revision: input.recordDefinitionRevision,
        p_operation_id: input.operationId,
        p_context_fingerprint: input.contextFingerprint,
      });
      if (error) throw error;
      return data as CompatibleRecordUpdateReceipt;
    },

    async updatePatientIdentity(patientId, identity, reason, expectedVersion) {
      const { data: row, error } = await client.rpc('update_patient_identity', {
        p_patient_id: patientId,
        p_full_name: identity.fullName,
        p_date_of_birth: identity.dateOfBirth,
        p_phone: identity.phone,
        p_address: identity.address,
        p_external_identifier: identity.externalIdentifier,
        p_reason: reason,
        p_expected_version: expectedVersion,
      });
      if (error) throw error;
      const r = (Array.isArray(row) ? row[0] : row) as PatientRow;
      return { version: r.row_version ?? null, updatedAt: r.updated_at ?? null };
    },

    async importRecords(baseId, rows, opts) {
      const { data, error } = await client.rpc('import_records', {
        p_base_id: baseId, p_rows: rows, p_dry_run: opts.dryRun, p_status: opts.status,
        p_conflict: opts.conflict, p_file_hash: opts.fileHash ?? null,
        p_template_version_id: opts.templateVersionId ?? null, p_batch_id: opts.batchId ?? null,
      });
      if (error) throw error;
      return data as ImportReport;
    },

    async beginImportBatch(baseId, opts) {
      const { data, error } = await client.rpc('begin_import_batch', {
        p_base_id: baseId, p_file_hash: opts.fileHash ?? null,
        p_template_version_id: opts.templateVersionId ?? null, p_conflict: opts.conflict, p_status: opts.status,
        p_expected_rows: opts.expectedRows ?? null,
      });
      if (error) throw error;
      return data as string;
    },

    async getImportBatchState(batchId) {
      const { data, error } = await client.rpc('get_import_batch_state', { p_batch_id: batchId });
      if (error) throw error;
      return data as ImportBatchState;
    },

    async completeImportBatch(batchId) {
      const { error } = await client.rpc('complete_import_batch', { p_batch_id: batchId });
      if (error) throw error;
    },

    async cancelImportBatch(batchId) {
      const { error } = await client.rpc('cancel_import_batch', { p_batch_id: batchId });
      if (error) throw error;
    },

    async getCompletionQueue(baseId, limit) {
      const { data, error } = await client.rpc('base_completion_queue', { p_base_id: baseId, p_limit: limit ?? 200 });
      if (error) throw error;
      return (data ?? []) as CompletionItem[];
    },

    async getCompletionQueuePage(baseId, limit, offset) {
      const { data, error } = await client.rpc('base_completion_queue_page', {
        p_base_id: baseId,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw error;
      const page = (data ?? {}) as Partial<CompletionQueuePage>;
      return {
        items: page.items ?? [],
        total: page.total ?? 0,
        limit: page.limit ?? limit,
        offset: page.offset ?? offset,
        hasMore: page.hasMore ?? false,
      };
    },
  };
}

export const patientRepository: PatientRepository = makePatientRepository(supabase);
