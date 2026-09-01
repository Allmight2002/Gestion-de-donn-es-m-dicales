// =============================================================================
// SAISIE HORS-LIGNE (offline intake-only) — contrat des operations (lot O0) et
// file locale dediee (lot O2) de la feuille de route « saisie hors-ligne ».
//
// SECURITE (invariants §3 de la feuille de route) :
//  * le serveur reste la source de verite : la validation, les droits, les
//    doublons et la creation finale sont controles par PostgreSQL/RPC/RLS ;
//  * l'identite d'un patient EN ATTENTE vit uniquement dans l'entree cloisonnee
//    de cette file (store IndexedDB `outbox`, partitionne par compte, TTL,
//    purge au changement de compte) — JAMAIS dans les brouillons localStorage,
//    le Cache Storage, ni dans un instantane analytique ;
//  * ce circuit ne fait que CREER : la lecture de la base reste indisponible
//    hors-ligne, et le contexte de saisie ne transporte aucune ligne patient.
// =============================================================================
import { useEffect, useState } from 'react';
import {
  INTAKE_CONTEXT_STORE, OUTBOX_STORE, OUTBOX_TTL_MS, getOfflineUser, idbTx, isIntakeEntry,
  newOfflineId, notifyOutboxChange, onOutboxChange,
} from './offline';
import type {
  EncounterCreateEntry, EncounterCreatePayload, IntakeEntry,
  OutboxRecord, PatientCreateEntry, PatientCreatePayload,
} from './offline';
import type { TemplateField, ValidationRule } from './types';

// Le contrat des operations vit dans offline.ts (union discriminée du store) ;
// on le re-exporte ici pour que les ecrans n'aient qu'un seul point d'entree.
export type {
  EncounterCreateEntry, EncounterCreatePayload, IntakeEntry, OfflineIntakeState,
  OutboxRecord, PatientCreateEntry, PatientCreatePayload,
} from './offline';

/** Politique produit : la saisie hors-ligne suit le meme verrou que la lecture
 * hors-ligne (VITE_OFFLINE_MODE=demo + accusé admin), plus son propre interrupteur. */
export const isOfflineIntakeEnabled = (): boolean =>
  import.meta.env.VITE_OFFLINE_MODE === 'demo'
  && import.meta.env.VITE_OFFLINE_ADMIN_ACK === 'true'
  && import.meta.env.VITE_OFFLINE_INTAKE === 'demo';
const assertIntakeEnabled = (): void => {
  if (!isOfflineIntakeEnabled()) throw new Error('La saisie hors-ligne est desactivee par la politique produit.');
};

const payloadOf = (e: IntakeEntry): PatientCreatePayload | EncounterCreatePayload => e.payload;

// --- Primitives pures du contrat -------------------------------------------------

/** Serialisation CANONIQUE (cles triees, sans `undefined`) : deux charges identiques
 * donnent la meme chaine, quel que soit l'ordre de saisie des champs. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function fallbackHash(text: string): string {
  // Repli deterministe (environnement sans WebCrypto) : FNV-1a double, etendu sur
  // 64 hex. Suffisant pour la detection LOCALE de mutation ; l'empreinte FAISANT FOI
  // reste celle que le serveur calcule lui-meme a la reception.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(4).slice(0, 64);
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackHash(text);
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Empreinte canonique d'une charge (immuabilite locale ; le serveur recalcule la sienne). */
export const fingerprintPayload = (payload: unknown): Promise<string> => sha256Hex(canonicalJson(payload));

const LOCAL_PATIENT_PREFIX = 'local-patient-';
const LOCAL_ENCOUNTER_PREFIX = 'local-encounter-';
export const newLocalPatientId = (): string => `${LOCAL_PATIENT_PREFIX}${newOfflineId()}`;
export const newLocalEncounterId = (): string => `${LOCAL_ENCOUNTER_PREFIX}${newOfflineId()}`;
export const isLocalPatientId = (id: string): boolean => id.startsWith(LOCAL_PATIENT_PREFIX);

/** Code patient hors-ligne : derive STABLE et improbable a collision depuis la cle
 * d'operation (recommandation O0), rejouable a l'identique apres une perte de reponse.
 * Un code explicite saisi par l'utilisateur reste possible et prime sur ce defaut. */
export async function offlinePatientCode(operationKey: string): Promise<string> {
  return `H-${(await sha256Hex(`patient-code:${operationKey}`)).slice(0, 8).toUpperCase()}`;
}

/** Ordre de synchronisation : les PATIENTS d'abord, puis leurs rencontres dependantes
 * (chaque famille garde l'ordre de creation). */
export function orderIntakeForSync(entries: IntakeEntry[]): IntakeEntry[] {
  const byCreation = (a: IntakeEntry, b: IntakeEntry) => a.createdAt - b.createdAt;
  return [
    ...entries.filter((e) => e.kind === 'patient_create').sort(byCreation),
    ...entries.filter((e) => e.kind === 'encounter_create').sort(byCreation),
  ];
}

// =====================================================================================
// CONTEXTE DE SAISIE (prepare EN LIGNE, consomme HORS-LIGNE)
// =====================================================================================

/** Droits RESOLUS EN LIGNE au moment de la preparation du contexte ; le serveur les
 * reevalue a la synchronisation (la validation locale n'est qu'un confort). */
export interface OfflineIntakePermissions {
  canCreateStructuredData: boolean;
  canEditStructuredData: boolean;
  canViewIdentity: boolean;
}

/** Contexte de saisie prepare EN LIGNE : gabarit versionne, regles, options et droits
 * necessaires au formulaire. Ne contient AUCUNE ligne patient ni rencontre. Les
 * metadonnees de gabarit sont celles des ecrans EN LIGNE (TemplateField[]) pour que
 * le formulaire hors-ligne soit exactement le meme que le formulaire connecte. */
export interface OfflineIntakeContext {
  dataType: 'intake_context';
  baseId: string;
  baseName: string;
  templateVersionId: string;
  observationModel: string;
  /** Variables completes du gabarit (tous scopes), dans leur forme d'affichage. */
  fields: TemplateField[];
  /** Regles de coherence versionnees (re-evaluees par le serveur a la synchronisation). */
  rules: ValidationRule[];
  permissions: OfflineIntakePermissions;
  preparedAt: number;
  expiresAt: number;
  ownerUserId?: string | null;
  key?: string;
}

const intakeContextKey = (baseId: string): string => `${getOfflineUser() ?? ''}::${baseId}`;

/** Duree de validite d'un contexte prepare en ligne (alignee sur l'instantane). */
export const INTAKE_CONTEXT_TTL_MS = 24 * 3600 * 1000;

export interface OfflineIntakeMeta {
  baseId: string;
  baseName: string;
  preparedAt: number;
  expiresAt: number;
}

/** Source EN LIGNE pour preparer un contexte : le depot des bases et celui des gabarits. */
export interface IntakeContextSource {
  getBase(baseId: string): Promise<{
    base: { id: string; name: string; currentTemplateVersionId: string | null; observationModel?: string | null };
    role: string;
    permissions: { canViewIdentity: boolean; canEditStructuredData: boolean };
    canCreateStructuredData?: boolean;
    /** Echeance de l'acces (compte de mission) : la saisie hors-ligne ne lui est pas proposee. */
    expiresAt?: string | null;
  } | null>;
  getVersion(versionId: string): Promise<{ fields: TemplateField[]; rules: ValidationRule[] }>;
}

/** Prepare EN LIGNE le contexte de saisie d'une base : metadonnees du formulaire SEUL.
 * Aucun patient, aucune rencontre, aucune image ne transitent par ce circuit — c'est
 * l'exception limitee decidee en cadrage, bornee au formulaire et a sa version. */
export async function downloadIntakeContext(
  baseId: string,
  src: IntakeContextSource,
  now = Date.now(),
): Promise<OfflineIntakeMeta> {
  assertIntakeEnabled();
  const listing = await src.getBase(baseId);
  if (!listing?.base.currentTemplateVersionId) throw new Error('Base introuvable ou sans gabarit courant');
  // Meme politique que l'instantane : un acces a echeance (mission) ne prepare pas de copie locale.
  if (listing.expiresAt != null) throw new Error('OFFLINE_INTAKE_MISSION_UNSUPPORTED');
  const version = await src.getVersion(listing.base.currentTemplateVersionId);
  const ctx: OfflineIntakeContext = {
    dataType: 'intake_context',
    baseId,
    baseName: listing.base.name,
    templateVersionId: listing.base.currentTemplateVersionId,
    observationModel: listing.base.observationModel ?? 'longitudinal',
    fields: version.fields,
    rules: version.rules,
    permissions: {
      canCreateStructuredData: listing.role === 'owner'
        || listing.canCreateStructuredData === true
        || listing.permissions.canEditStructuredData,
      canEditStructuredData: listing.role === 'owner' || listing.permissions.canEditStructuredData,
      canViewIdentity: listing.role === 'owner' || listing.permissions.canViewIdentity,
    },
    preparedAt: now,
    expiresAt: now + INTAKE_CONTEXT_TTL_MS,
  };
  await intakeContextCache.save(ctx);
  return { baseId, baseName: ctx.baseName, preparedAt: ctx.preparedAt, expiresAt: ctx.expiresAt };
}

export const intakeContextCache = {
  async save(ctx: OfflineIntakeContext): Promise<void> {
    assertIntakeEnabled();
    const user = getOfflineUser();
    if (!user) throw new Error('Aucun compte actif pour preparer un contexte de saisie.');
    await idbTx(INTAKE_CONTEXT_STORE, 'readwrite', (s) =>
      s.put({ ...ctx, dataType: 'intake_context' as const, ownerUserId: user, key: intakeContextKey(ctx.baseId) }));
  },
  async get(baseId: string): Promise<OfflineIntakeContext | null> {
    if (!isOfflineIntakeEnabled() || !getOfflineUser()) return null;
    const ctx = await idbTx<OfflineIntakeContext | undefined>(INTAKE_CONTEXT_STORE, 'readonly',
      (s) => s.get(intakeContextKey(baseId)));
    if (!ctx || ctx.dataType !== 'intake_context') return null;
    if ((ctx.ownerUserId ?? null) !== getOfflineUser()) return null;
    if (Date.now() > ctx.expiresAt) { void intakeContextCache.remove(baseId); return null; }
    return ctx;
  },
  async remove(baseId: string): Promise<void> {
    await idbTx(INTAKE_CONTEXT_STORE, 'readwrite', (s) => s.delete(intakeContextKey(baseId)));
  },
};

// =====================================================================================
// FILE DES CREATIONS EN ATTENTE (extension du store `outbox`, union discriminee)
// =====================================================================================
async function putIntake(entry: IntakeEntry): Promise<void> {
  await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.put(entry));
  notifyOutboxChange();
}

async function removeIntake(id: string): Promise<void> {
  await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.delete(id));
  notifyOutboxChange();
}

/** Entrees de saisie du COMPTE COURANT (cloisonnement §5.5), par creation croissante. */
async function listMyIntakes(baseId?: string): Promise<IntakeEntry[]> {
  const all = await idbTx<OutboxRecord[]>(OUTBOX_STORE, 'readonly', (s) => s.getAll());
  return all
    .filter(isIntakeEntry)
    .filter((e) => (e.ownerUserId ?? null) === getOfflineUser())
    .filter((e) => (baseId ? e.baseId === baseId : true))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export const intakeQueue = {
  list: listMyIntakes,
  async get(id: string): Promise<IntakeEntry | null> {
    const e = await idbTx<OutboxRecord | undefined>(OUTBOX_STORE, 'readonly', (s) => s.get(id));
    return e && isIntakeEntry(e) && (e.ownerUserId ?? null) === getOfflineUser() ? e : null;
  },
  /** Saisies visibles dans la file locale : tout sauf les traces de reussite. */
  async visible(baseId?: string): Promise<IntakeEntry[]> {
    return (await listMyIntakes(baseId)).filter((e) => e.state !== 'succeeded');
  },
  /** Resume « patient en attente » pour l'ecran dedie (jamais melange a la liste serveur). */
  async pendingPatients(baseId?: string): Promise<PatientCreateEntry[]> {
    return (await listMyIntakes(baseId)).filter(
      (e): e is PatientCreateEntry => e.kind === 'patient_create'
        && (e.state === 'pending' || e.state === 'syncing' || e.state === 'blocked'),
    );
  },
  /** Patient local EN ATTENTE par identifiant local (navigation hors-ligne). */
  async localPatient(localPatientId: string): Promise<PatientCreateEntry | null> {
    const hit = (await listMyIntakes()).find(
      (e): e is PatientCreateEntry =>
        e.kind === 'patient_create'
        && e.localPatientId === localPatientId
        && e.state !== 'rejected'
        && e.state !== 'expired',
    );
    return hit ?? null;
  },
};

const requireActiveAccount = (): string => {
  const user = getOfflineUser();
  if (!user) throw new Error('Aucun compte actif pour la saisie hors-ligne.');
  return user;
};

const requireReadyContext = async (baseId: string): Promise<OfflineIntakeContext> => {
  const ctx = await intakeContextCache.get(baseId);
  // Invariant §3.12 : sans contexte prepare en ligne, la creation hors-ligne est refusee
  // avec un message explicite (jamais de formulaire improvise).
  if (!ctx) throw new Error('OFFLINE_INTAKE_CONTEXT_REQUIRED');
  return ctx;
};

/** Verifie la coherence d'une re-mise en file : une meme cle d'operation rejouee avec
 * la MEME charge est un no-op (retour de l'entree existante) ; une charge DIFFERENTE
 * est refusee (invariant §3.3 : le contenu d'une cle est immuable). */
async function reconcileSameKey(existing: IntakeEntry, payload: PatientCreatePayload | EncounterCreatePayload): Promise<IntakeEntry> {
  if ((await fingerprintPayload(payloadOf(existing))) !== (await fingerprintPayload(payload))) {
    throw new Error('OFFLINE_OPERATION_MISMATCH');
  }
  return existing;
}

/** Met en file une creation patient hors-ligne. L'ECRAN fournit la cle d'operation
 * (stable pour une meme intention, comme pour les corrections) ; le code patient est
 * celui du formulaire — genere depuis la cle ou saisi explicitement. */
export async function enqueuePatientCreate(input: {
  baseId: string;
  operationKey: string;
  payload: PatientCreatePayload;
}): Promise<PatientCreateEntry> {
  assertIntakeEnabled();
  const user = requireActiveAccount();
  await requireReadyContext(input.baseId);
  if (!input.operationKey || !input.payload.code.trim()) throw new Error('OFFLINE_OPERATION_INVALID');
  const existing = await intakeQueue.get(input.operationKey);
  if (existing && existing.kind === 'patient_create') return await reconcileSameKey(existing, input.payload) as PatientCreateEntry;
  if (existing) throw new Error('OFFLINE_OPERATION_MISMATCH');
  const createdAt = Date.now();
  const entry: PatientCreateEntry = {
    dataType: 'intake_outbox',
    kind: 'patient_create',
    id: input.operationKey,
    baseId: input.baseId,
    state: 'pending',
    fingerprint: await fingerprintPayload(input.payload),
    localPatientId: newLocalPatientId(),
    payload: input.payload,
    createdAt,
    expiresAt: createdAt + OUTBOX_TTL_MS,
    attemptCount: 0,
    ownerUserId: user,
  };
  await putIntake(entry);
  return entry;
}

/** Met en file une rencontre DEPENDANTE d'un patient encore local (ou deja synchronise
 * pendant la meme session hors-ligne). Le parent doit exister et etre recuperable. */
export async function enqueueEncounterCreate(input: {
  baseId: string;
  operationKey: string;
  parentOperationKey: string;
  payload: EncounterCreatePayload;
}): Promise<EncounterCreateEntry> {
  assertIntakeEnabled();
  const user = requireActiveAccount();
  await requireReadyContext(input.baseId);
  if (!input.operationKey) throw new Error('OFFLINE_OPERATION_INVALID');
  const existing = await intakeQueue.get(input.operationKey);
  if (existing && existing.kind === 'encounter_create') return await reconcileSameKey(existing, input.payload) as EncounterCreateEntry;
  if (existing) throw new Error('OFFLINE_OPERATION_MISMATCH');
  const parent = await intakeQueue.get(input.parentOperationKey);
  if (!parent || parent.kind !== 'patient_create') throw new Error('OFFLINE_INTAKE_PARENT_INVALID');
  if (parent.state === 'rejected' || parent.state === 'conflict' || parent.state === 'expired') {
    throw new Error('OFFLINE_INTAKE_PARENT_REJECTED');
  }
  const createdAt = Date.now();
  const entry: EncounterCreateEntry = {
    dataType: 'intake_outbox',
    kind: 'encounter_create',
    id: input.operationKey,
    baseId: input.baseId,
    state: 'pending',
    fingerprint: await fingerprintPayload(input.payload),
    localEncounterId: newLocalEncounterId(),
    parentOperationKey: input.parentOperationKey,
    payload: input.payload,
    createdAt,
    expiresAt: createdAt + OUTBOX_TTL_MS,
    attemptCount: 0,
    ownerUserId: user,
  };
  await putIntake(entry);
  return entry;
}

/** Abandon avec confirmation (cote ecran) d'une saisie en attente. Supprimer un patient
 * en attente supprime AUSSI ses rencontres dependantes (cascade, invariant O2). */
export async function discardIntake(operationId: string): Promise<number> {
  const entry = await intakeQueue.get(operationId);
  if (!entry || entry.state === 'syncing') return 0;
  await removeIntake(operationId);
  let removed = 1;
  if (entry.kind === 'patient_create') {
    for (const dep of await listMyIntakes(entry.baseId)) {
      if (dep.kind === 'encounter_create' && dep.parentOperationKey === operationId && dep.state !== 'syncing') {
        await removeIntake(dep.id);
        removed += 1;
      }
    }
  }
  return removed;
}

export async function retryIntake(operationId: string): Promise<void> {
  const entry = await intakeQueue.get(operationId);
  if (!entry) return;
  // Une operation BLOQUEE par son parent ne se delivre pas seule : seul le retour du
  // parent a un etat recuperable peut la liberer (au prochain passage de synchronisation).
  if (entry.state === 'blocked' || entry.state === 'syncing') return;
  await putIntake({ ...entry, state: 'pending', syncingStartedAt: undefined });
}

// =====================================================================================
// SYNCHRONISATION (lot O4) — reprise ordonnee, sure, explicable
// =====================================================================================
export interface IntakeFlushDeps {
  replayPatientCreate(input: { operationKey: string; baseId: string } & PatientCreatePayload):
    Promise<{ id: string; code: string }>;
  replayEncounterCreate(input: {
    operationKey: string; parentOperationKey: string | null; patientId: string | null;
  } & EncounterCreatePayload): Promise<{ id: string; patientId: string }>;
}

export interface IntakeFlushReport {
  syncedPatients: number;
  syncedEncounters: number;
  blocked: number;
  conflicts: number;
  failed: number;
  errors: string[];
}

type SyncErrorKind = 'conflict' | 'rejected' | 'transient';
export const classifyIntakeSyncError = (error: unknown): SyncErrorKind => {
  const e = error as { message?: string; code?: string; status?: number; statusCode?: number } | null;
  const message = e?.message ?? String(error);
  const status = e?.status ?? e?.statusCode;
  if (/CONFLIT_VERSION/i.test(message)) return 'conflict';
  if (
    status === 401 || status === 403 || e?.code === '23505' || e?.code === '42501'
    || /permission denied|not authorized|unauthorized|forbidden/i.test(message)
    // Rejets explicites du serveur : doublon d'identite, collision/rejeu incoherent,
    // cle ou charge invalide, ressource disparue.
    || /OFFLINE_IDENTITY_DUPLICATE|OFFLINE_OPERATION_(?:MISMATCH|INVALID)|duplicate key|uq_identity_base_code|RESOURCE_NOT_FOUND|Acces refuse/i.test(message)
  ) return 'rejected';
  // Parent pas encore confirme cote serveur : la dependance sera rejouee apres lui
  // (l'ordre de cette file garantit le patient avant ses rencontres).
  if (/OFFLINE_PARENT_NOT_SYNCED|OFFLINE_OPERATION_INCOMPLETE/i.test(message)) return 'transient';
  return 'transient';
};

const activeIntakeIds = new Set<string>();

/** Reprend les leases `syncing` qui n'appartiennent a aucun flux actif de ce runtime. */
export async function recoverAbandonedIntakes(baseId?: string): Promise<number> {
  let recovered = 0;
  for (const entry of await listMyIntakes(baseId)) {
    if (entry.state === 'syncing' && !activeIntakeIds.has(entry.id)) {
      await putIntake({ ...entry, state: 'pending', syncingStartedAt: undefined });
      recovered += 1;
    }
  }
  return recovered;
}

/**
 * Rejoue les creations en attente, dans l'ordre des dependances :
 *   1. marquage des rencontres dont le parent est perdu (rejet/conflit/expiration) ;
 *   2. patients, puis encounters — chaque succes note le mapping local -> serveur ;
 *   3. aucun envoi si la charge locale ne correspond plus a son empreinte.
 */
export async function flushIntake(deps: IntakeFlushDeps, baseId?: string): Promise<IntakeFlushReport> {
  assertIntakeEnabled();
  await recoverAbandonedIntakes(baseId);
  const rep: IntakeFlushReport = { syncedPatients: 0, syncedEncounters: 0, blocked: 0, conflicts: 0, failed: 0, errors: [] };
  const mine = await listMyIntakes(baseId);
  const parents = new Map(mine.filter((e): e is PatientCreateEntry => e.kind === 'patient_create').map((e) => [e.id, e]));

  // 1. Les rencontres dont le parent est definitivement perdu deviennent visibles comme
  //    bloquees : jamais synchronisees en aveugle, jamais supprimees silencieusement.
  for (const e of mine) {
    if (e.kind !== 'encounter_create' || e.state === 'succeeded' || e.state === 'syncing' || e.state === 'blocked') continue;
    const parent = parents.get(e.parentOperationKey);
    const lostParent = !parent
      || parent.state === 'rejected' || parent.state === 'conflict' || parent.state === 'expired';
    if (lostParent) {
      await putIntake({ ...e, state: 'blocked', lastError: e.lastError ?? 'OFFLINE_PARENT_LOST' });
      rep.blocked += 1;
    }
  }

  // 2. Rejeu ordonne des operations en attente.
  for (const e of orderIntakeForSync(await listMyIntakes(baseId)).filter((x) => x.state === 'pending')) {
    if (e.expiresAt <= Date.now()) {
      await putIntake({ ...e, state: 'expired' });
      rep.failed += 1;
      rep.errors.push(`Saisie hors-ligne expiree: ${e.id}`);
      continue;
    }
    if (activeIntakeIds.has(e.id)) continue;
    // Garde-fou AUTHORITATIF au moment de l'envoi : une rencontre ne part QUE si son
    // parent est encore vivant — y compris quand il vient d'echouer DANS CE MEME
    // passage (rejet/conflit/expiration du patient -> dependance bloquee sur-le-champ).
    // L'etat est RELU (jamais le snapshot du debut du passage, qui serait perime).
    if (e.kind === 'encounter_create') {
      const live = await intakeQueue.get(e.parentOperationKey);
      const lostParent = !live
        || live.state === 'rejected' || live.state === 'conflict' || live.state === 'expired';
      if (lostParent) {
        await putIntake({ ...e, state: 'blocked', lastError: e.lastError ?? 'OFFLINE_PARENT_LOST' });
        rep.blocked += 1;
        continue;
      }
    }
    if ((await fingerprintPayload(payloadOf(e))) !== e.fingerprint) {
      await putIntake({ ...e, state: 'rejected', lastError: 'OFFLINE_OPERATION_MISMATCH' });
      rep.failed += 1;
      rep.errors.push('OFFLINE_OPERATION_MISMATCH');
      continue;
    }
    const attemptCount = (e.attemptCount ?? 0) + 1;
    const lastAttemptAt = Date.now();
    try {
      activeIntakeIds.add(e.id);
      await putIntake({ ...e, state: 'syncing', attemptCount, lastAttemptAt, syncingStartedAt: lastAttemptAt, lastError: undefined });
      if (e.kind === 'patient_create') {
        const created = await deps.replayPatientCreate({ operationKey: e.id, baseId: e.baseId, ...e.payload });
        await putIntake({
          ...e, state: 'succeeded', serverPatientId: created.id, serverCode: created.code,
          attemptCount, lastAttemptAt, syncingStartedAt: undefined, lastError: undefined,
        });
        rep.syncedPatients += 1;
      } else {
        const created = await deps.replayEncounterCreate({
          operationKey: e.id, parentOperationKey: e.parentOperationKey, patientId: null, ...e.payload,
        });
        await putIntake({
          ...e, state: 'succeeded', serverEncounterId: created.id, serverPatientId: created.patientId,
          attemptCount, lastAttemptAt, syncingStartedAt: undefined, lastError: undefined,
        });
        rep.syncedEncounters += 1;
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      const kind = classifyIntakeSyncError(err);
      if (kind === 'conflict') {
        await putIntake({ ...e, state: 'conflict', attemptCount, lastAttemptAt, syncingStartedAt: undefined, lastError: m });
        rep.conflicts += 1;
      } else if (kind === 'rejected') {
        await putIntake({ ...e, state: 'rejected', attemptCount, lastAttemptAt, syncingStartedAt: undefined, lastError: m });
        rep.failed += 1;
        rep.errors.push(m);
      } else {
        await putIntake({ ...e, state: 'pending', attemptCount, lastAttemptAt, syncingStartedAt: undefined, lastError: m });
        rep.failed += 1;
        rep.errors.push(m);
      }
    } finally {
      activeIntakeIds.delete(e.id);
    }
  }

  // 3. Traces de reussite expirees : menage local (le mapping utile a deja servi).
  for (const e of await listMyIntakes(baseId)) {
    if (e.state === 'succeeded' && e.expiresAt <= Date.now()) await removeIntake(e.id);
  }
  return rep;
}

// =====================================================================================
// HOOK REACT : liste reactive des saisies en attente du compte courant.
// =====================================================================================
export function useIntakeQueue(baseId?: string): IntakeEntry[] {
  const [entries, setEntries] = useState<IntakeEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void intakeQueue.visible(baseId)
        .then((e) => { if (alive) setEntries(e); })
        .catch(() => { if (alive) setEntries([]); });
    };
    refresh();
    const off = onOutboxChange(refresh);
    return () => { alive = false; off(); };
  }, [baseId]);
  return entries;
}
