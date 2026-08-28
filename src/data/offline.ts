// Cache HORS-LIGNE (Phase 1, lecture seule). Stocke un INSTANTANE ANALYTIQUE d'une base
// (patients + rencontres) dans IndexedDB, pour CONSULTER la base sans reseau.
//
// SECURITE — separation des zones jusque sur l'appareil : l'instantane ne contient JAMAIS
// l'IDENTITE (nom, date de naissance) ni les IMAGES. `buildSnapshot` ne recopie que les champs
// analytiques, meme si on lui passe un patient complet -> garantie par construction. L'identite
// reste accessible UNIQUEMENT en ligne (via la RLS).
import { useEffect, useState } from 'react';
import { mergeKeepBoth } from '../domain/conflictMerge';

export interface OfflineEncounter {
  id: string;
  encounterType: string;
  encounterDate: string;
  validationStatus: string;
  ageValue: number | null;
  ageUnit: string | null;
  data: Record<string, unknown>;
  /** Version optimiste serveur (jeton de conflit pour la synchro). */
  updatedAt?: string | null;
  /** §5.7 : version de gabarit de CETTE rencontre (choix du bon dictionnaire hors-ligne). */
  templateVersionId?: string | null;
  /** true si une modification locale n'est pas encore synchronisee (affichage). */
  pending?: boolean;
}

export interface OfflinePatient {
  id: string;
  code: string;
  templateVersionId: string;
  data: Record<string, unknown>;
  validationStatus: string;
  encounters: OfflineEncounter[];
}

/** Champ de gabarit (metadonnee, pas une donnee patient) : permet d'afficher libelles/colonnes hors-ligne. */
export interface OfflineField {
  id: string;
  fieldKey: string;
  label: string;
  scope: string; // 'patient' | 'encounter'
  type: string;
  /**
   * Cardinalite du champ (L21). `download_base_snapshot` la transporte deja ; sans elle, une
   * liste de diagnostics s'ouvrirait hors connexion dans le formulaire UNITAIRE : les valeurs
   * deja saisies seraient invisibles et la premiere saisie les remplacerait.
   * Absente d'un instantane telecharge avant ce lot -> unitaire.
   */
  isMultiple?: boolean;
  displayOrder: number;
  // §7.5 : metadonnees COMPLETES pour editer hors-ligne comme en ligne (groupage par section,
  // unite, liste de valeurs, caractere requis, bornes, codes manquants, types de rencontre).
  // Optionnelles : un instantane ANTERIEUR a cette version n'en dispose pas (replis a l'affichage).
  section?: string | null;
  /** Consigne de saisie (L27) et valeur proposee (L28) : le formulaire hors-ligne est le meme. */
  description?: string | null;
  defaultValue?: string | null;
  unit?: string | null;
  allowedValues?: string[] | null;
  /** Options de liste (L30). Absente d'un instantane telecharge avant ce lot : repli sur
   *  `allowedValues`, ou cle et libelle se confondent -- le comportement d'alors. */
  allowedOptions?: unknown[] | null;
  required?: boolean;
  minValue?: number | null;
  maxValue?: number | null;
  allowMissingCodes?: boolean;
  /** Raisons de valeur manquante (L33). Absente d'un instantane telecharge avant ce lot. */
  missingReasons?: string[] | null;
  /**
   * Variable calculee (L35). Seule la METADONNEE voyage : le calcul vit deja cote client,
   * donc le formulaire hors-ligne affiche exactement le meme resultat que le formulaire en
   * ligne. Absente d'un instantane telecharge avant ce lot -> variable saisie, comme alors.
   */
  formula?: string | null;
  encounterTypes?: string[] | null;
}

export interface OfflineRule {
  id: string;
  rule: unknown;
  message: string | null;
  severity: 'block' | 'warn';
}

export interface OfflineSnapshot {
  dataType: 'analytic_snapshot';
  baseId: string;
  baseName: string;
  templateVersionId: string | null;
  fields: OfflineField[];
  /** §5.7 : dictionnaire PAR VERSION (toutes les versions presentes) ; `fields` = version courante. */
  fieldsByVersion?: Record<string, OfflineField[]>;
  rulesByVersion?: Record<string, OfflineRule[]>;
  patients: OfflinePatient[];
  cachedAt: number; // epoch ms
  expiresAt: number; // epoch ms
  /** §5.5 : utilisateur proprietaire de cet instantane (cloisonnement sur poste partage). */
  ownerUserId?: string | null;
  /** §5.9 : cle IndexedDB composite `ownerUserId::baseId` (deux comptes ne s'ecrasent plus). */
  key?: string;
}

/** Metadonnees legeres d'un instantane (sans la liste des patients). */
export interface OfflineMeta {
  baseId: string;
  baseName: string;
  cachedAt: number;
  expiresAt: number;
  patientCount: number;
}

/** Production: aucune donnee clinique reelle hors-ligne. Exception demo explicite uniquement. */
export const isOfflineEnabled = (): boolean =>
  import.meta.env.VITE_OFFLINE_MODE === 'demo' && import.meta.env.VITE_OFFLINE_ADMIN_ACK === 'true';
export const offlinePolicy = {
  get enabled() { return isOfflineEnabled(); },
  get mode() { return import.meta.env.VITE_OFFLINE_MODE === 'demo' ? 'demo' : 'disabled'; },
} as const;
const assertOfflineEnabled = (): void => {
  if (!isOfflineEnabled()) throw new Error('Le mode hors-ligne est desactive par la politique produit.');
};
export const OFFLINE_TTL_MS = 24 * 3600 * 1000;
export const OUTBOX_TTL_MS = 24 * 3600 * 1000;
// §5.8 : au-dela de ce nombre de patients, l'instantane (un seul gros bloc JSON) devient lourd
// (memoire, quota IndexedDB, delai) -> on demande confirmation avant de le telecharger.
export const MAX_OFFLINE_PATIENTS = 2000;

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function isExpired(snap: { expiresAt: number }, now = Date.now()): boolean {
  return now > snap.expiresAt;
}

// §5.5 — CLOISONNEMENT PAR UTILISATEUR (poste partage). Le cache hors-ligne (instantanes +
// outbox) appartient a UN compte : un autre compte connecte sur le meme appareil ne doit jamais
// lire les instantanes ni rejouer les ecritures en attente d'un autre. L'utilisateur courant est
// fixe par la couche d'authentification (setOfflineUser, appele a chaque changement de session) ;
// get/list/outbox filtrent dessus -> aucune voie de lecture inter-comptes. (Injectable -> testable.)
let currentUser: string | null = null;
export function setOfflineUser(userId: string | null): void { currentUser = userId; }
/** Utilisateur courant du cache local (pour partitionner brouillons/instantanes par compte). */
export function getOfflineUser(): string | null { return currentUser; }
const ownedByCurrent = (o: { ownerUserId?: string | null }) => (o.ownerUserId ?? null) === currentUser;
// §5.9 : cle composite -> deux comptes qui cachent la MEME base ne s'ecrasent plus (poste partage).
const snapKey = (baseId: string): string => `${currentUser ?? ''}::${baseId}`;

// Construit un instantane ANALYTIQUE : ne retient QUE les champs analytiques (aucune identite).
export function buildSnapshot(
  base: { id: string; name: string; templateVersionId: string | null },
  patients: { id: string; code: string; templateVersionId: string; data: Record<string, unknown>; validationStatus: string }[],
  encountersByPatient: Record<string, OfflineEncounter[]>,
  fields: OfflineField[] = [],
  now = Date.now(),
  fieldsByVersion?: Record<string, OfflineField[]>, // §5.7
  rulesByVersion?: Record<string, OfflineRule[]>,
): OfflineSnapshot {
  return {
    dataType: 'analytic_snapshot',
    baseId: base.id,
    baseName: base.name,
    templateVersionId: base.templateVersionId,
    fields: fields.map((f) => ({
      id: f.id, fieldKey: f.fieldKey, label: f.label, scope: f.scope, type: f.type,
      isMultiple: f.isMultiple ?? false, displayOrder: f.displayOrder,
      // §7.5 : metadonnees completes conservees (edition hors-ligne fidele a l'edition en ligne).
      section: f.section ?? null, description: f.description ?? null, defaultValue: f.defaultValue ?? null,
      unit: f.unit ?? null, allowedValues: f.allowedValues ?? null,
      // Les DEUX formes, meme raison qu'a L33 : les cles pour une copie de l'appli
      // anterieure au lot, les options pour les autres.
      allowedOptions: f.allowedOptions ?? null,
      required: f.required ?? false, minValue: f.minValue ?? null, maxValue: f.maxValue ?? null,
      // Les DEUX sont conserves : le booleen pour une copie de l'appli anterieure a L33, la
      // liste pour les autres. Un instantane sans liste retombe sur les trois codes
      // historiques -- exactement ce que la variable proposait alors.
      allowMissingCodes: f.allowMissingCodes ?? true,
      missingReasons: f.missingReasons ?? null, formula: f.formula ?? null,
      encounterTypes: f.encounterTypes ?? null,
    })),
    fieldsByVersion,
    rulesByVersion,
    patients: patients.map((p) => ({
      id: p.id,
      code: p.code,
      templateVersionId: p.templateVersionId,
      data: p.data,
      validationStatus: p.validationStatus,
      encounters: (encountersByPatient[p.id] ?? []).map((e) => ({
        id: e.id, encounterType: e.encounterType, encounterDate: e.encounterDate,
        validationStatus: e.validationStatus, ageValue: e.ageValue, ageUnit: e.ageUnit, data: e.data,
        updatedAt: e.updatedAt ?? null, templateVersionId: e.templateVersionId,
      })),
    })),
    cachedAt: now,
    expiresAt: now + OFFLINE_TTL_MS,
  };
}

export const snapshotMeta = (s: OfflineSnapshot): OfflineMeta => ({
  baseId: s.baseId, baseName: s.baseName, cachedAt: s.cachedAt, expiresAt: s.expiresAt, patientCount: s.patients.length,
});

// --- IndexedDB : 2 object stores -> `snapshots` (cle baseId), `outbox` (cle id) -----------
const DB_NAME = 'meddata-offline';
const DB_VERSION = 3; // v3 : cle snapshot composite `ownerUserId::baseId` (§5.9)
const STORE = 'snapshots';
const OUTBOX = 'outbox';
// Migration securite: declenche la reevaluation/purge des enveloppes legacy.
const SECURITY_DB_VERSION = DB_VERSION + 1;

function openDb(): Promise<IDBDatabase> {
  // IndexedDB peut etre absent (SSR, vieux navigateur, environnement de test sans polyfill).
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB indisponible'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, SECURITY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // §5.9 : la cle du snapshot passe de `baseId` a `ownerUserId::baseId`. Changer un keyPath
      // impose de RECREER le store -> les anciens instantanes sont perdus (re-telechargeables).
      // L'outbox (keyPath 'id', travail non synchronise) est preservee.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Execute une transaction et resout APRES le commit (durabilite), avec le resultat de la requete.
function tx<T>(store: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        let result: T;
        const req = fn(t.objectStore(store));
        req.onsuccess = () => { result = req.result as T; };
        t.oncomplete = () => { db.close(); resolve(result); };
        t.onerror = () => { db.close(); reject(t.error); };
        t.onabort = () => { db.close(); reject(t.error); };
      }),
  );
}

export interface OfflineCache {
  save(snap: OfflineSnapshot): Promise<void>;
  get(baseId: string): Promise<OfflineSnapshot | null>;
  list(): Promise<OfflineMeta[]>;
  remove(baseId: string): Promise<void>;
}

export const offlineCache: OfflineCache = {
  // L'enregistreur est le proprietaire : on estampille l'utilisateur + on pose la cle composite.
  async save(snap) {
    assertOfflineEnabled();
    if (!currentUser) throw new Error('Aucun proprietaire de cache hors-ligne actif.');
    await tx(STORE, 'readwrite', (s) => s.put({ ...snap, dataType: 'analytic_snapshot', ownerUserId: currentUser, key: snapKey(snap.baseId) }));
  },
  async get(baseId) {
    if (!isOfflineEnabled() || !currentUser) return null;
    const snap = await tx<OfflineSnapshot | undefined>(STORE, 'readonly', (s) => s.get(snapKey(baseId)));
    if (snap && snap.dataType !== 'analytic_snapshot') return null;
    if (!snap || !ownedByCurrent(snap)) return null;            // §5.5 : pas de lecture inter-comptes
    if (isExpired(snap)) { void offlineCache.remove(baseId); return null; } // §5.6 : TTL applique
    return snap;
  },
  async list() {
    if (!isOfflineEnabled() || !currentUser) return [];
    const mine = (await tx<OfflineSnapshot[]>(STORE, 'readonly', (s) => s.getAll())).filter(ownedByCurrent);
    for (const s of mine) if (isExpired(s)) void offlineCache.remove(s.baseId); // purge a la lecture
    return mine.filter((s) => s.dataType === 'analytic_snapshot' && !isExpired(s)).map(snapshotMeta);
  },
  async remove(baseId) { await tx(STORE, 'readwrite', (s) => s.delete(snapKey(baseId))); },
};

// Supprime un instantane par sa cle composite propre (utilise par les purges tous-comptes).
const deleteByKey = (key: string) => tx(STORE, 'readwrite', (s) => s.delete(key));

// §5.6 — purge des instantanes EXPIRES (TOUS comptes), pour le menage au demarrage.
export async function purgeExpiredSnapshots(now = Date.now()): Promise<void> {
  const all = await tx<OfflineSnapshot[]>(STORE, 'readonly', (s) => s.getAll());
  for (const s of all) if ((s.dataType !== 'analytic_snapshot' || isExpired(s, now)) && s.key) await deleteByKey(s.key);
}

// §5.6/§5.9 — a la DECONNEXION, vide UNIQUEMENT les instantanes de l'utilisateur COURANT (pas ceux
// des autres comptes du meme appareil). A appeler AVANT setOfflineUser(null). L'outbox (travail non
// synchronise) est conservee mais cloisonnee.
export async function clearOfflineSnapshots(userId: string | null = currentUser): Promise<void> {
  // §7.3 : on CAPTURE l'utilisateur a l'appel (parametre, evalue synchroniquement) -> le filtre ne
  // depend plus de la variable globale mutable pendant l'execution asynchrone (la deconnexion remet
  // currentUser a null juste apres l'appel).
  try {
    const mine = (await tx<OfflineSnapshot[]>(STORE, 'readonly', (s) => s.getAll())).filter((s) => (s.ownerUserId ?? null) === userId);
    for (const s of mine) if (s.key) await deleteByKey(s.key);
  } catch { /* IndexedDB indisponible */ }
}

// =====================================================================================
// OUTBOX — file d'attente des ECRITURES preparees hors-ligne (Phases 2/3).
// Seul l'ANALYTIQUE est concerne (corrections de rencontres) ; jamais l'identite/images.
// La synchronisation rejoue chaque entree via la MEME RPC validee (update_encounter), avec
// un verrou optimiste (baseUpdatedAt) -> aucune voie d'ecriture parallele, integrite preservee.
// =====================================================================================
export interface OutboxEntry {
  dataType: 'analytic_outbox';
  id: string;
  baseId: string;
  patientId: string;
  encounterId: string;
  data: Record<string, unknown>;     // nouvelle valeur analytique
  reason: string;                    // motif de correction (requis)
  validationStatus: string;          // statut cible de la rencontre
  baseUpdatedAt: string | null;      // jeton optimiste = version vue hors-ligne
  createdAt: number;
  expiresAt: number;
  state: 'pending' | 'syncing' | 'succeeded' | 'rejected' | 'expired' | 'conflict';
  attemptCount?: number;
  lastAttemptAt?: number;
  syncingStartedAt?: number;
  lastError?: string;
  serverData?: Record<string, unknown>; // valeur serveur (renseignee en cas de conflit, pour l'UI)
  /** §5.5 : auteur de l'ecriture en attente (cloisonnement sur poste partage). */
  ownerUserId?: string | null;
}

const newId = (): string =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? globalThis.crypto.randomUUID()
    : `ob-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const outboxEvents: EventTarget | null = typeof EventTarget !== 'undefined' ? new EventTarget() : null;
const emitOutboxChange = () => outboxEvents?.dispatchEvent(new Event('change'));

export const outbox = {
  async put(entry: OutboxEntry) { await tx(OUTBOX, 'readwrite', (s) => s.put(entry)); emitOutboxChange(); },
  async list(baseId?: string): Promise<OutboxEntry[]> {
    const all = (await tx<OutboxEntry[]>(OUTBOX, 'readonly', (s) => s.getAll())).filter(ownedByCurrent); // §5.5
    return (baseId ? all.filter((e) => e.baseId === baseId) : all).filter((e) => e.dataType === 'analytic_outbox').sort((a, b) => a.createdAt - b.createdAt);
  },
  async get(id: string): Promise<OutboxEntry | null> {
    const e = await tx<OutboxEntry | undefined>(OUTBOX, 'readonly', (s) => s.get(id));
    return e && ownedByCurrent(e) ? e : null; // §5.5 : pas de resolution d'une entree d'un autre compte
  },
  async remove(id: string) { await tx(OUTBOX, 'readwrite', (s) => s.delete(id)); emitOutboxChange(); },
  async count(baseId?: string) { return (await this.list(baseId)).length; },
};

// Applique une transformation a une rencontre DANS le cache (maj optimiste / retour serveur).
async function patchCachedEncounter(
  baseId: string,
  encounterId: string,
  fn: (e: OfflineEncounter) => OfflineEncounter,
): Promise<void> {
  const snap = await offlineCache.get(baseId);
  if (!snap) return;
  let changed = false;
  for (const p of snap.patients) {
    p.encounters = p.encounters.map((e) => {
      if (e.id !== encounterId) return e;
      changed = true;
      return fn(e);
    });
  }
  if (changed) await offlineCache.save(snap);
}

// Met en file une correction de rencontre + reflete la modif dans le cache (marquee "pending").
export async function enqueueEncounterUpdate(input: {
  baseId: string; patientId: string; encounterId: string;
  data: Record<string, unknown>; reason: string; validationStatus: string; baseUpdatedAt: string | null;
}): Promise<OutboxEntry> {
  assertOfflineEnabled();
  if (!currentUser) throw new Error('Aucun proprietaire de cache hors-ligne actif.');
  const createdAt = Date.now();
  const entry: OutboxEntry = {
    id: newId(), dataType: 'analytic_outbox', createdAt, expiresAt: createdAt + OUTBOX_TTL_MS,
    state: 'pending', attemptCount: 0, ownerUserId: currentUser, ...input,
  };
  await outbox.put(entry);
  await patchCachedEncounter(input.baseId, input.encounterId, (e) => ({
    ...e, data: input.data, validationStatus: input.validationStatus, pending: true,
  }));
  return entry;
}

export interface FlushDeps {
  updateEncounter(
    encounterId: string,
    data: Record<string, unknown>,
    status: string,
    reason: string,
    expectedUpdatedAt: string | null,
    operationId: string,
  ): Promise<unknown>;
  getEncounter(encounterId: string): Promise<{ data: Record<string, unknown>; updatedAt?: string | null } | null>;
}
export interface FlushReport { synced: number; conflicts: number; failed: number; errors: string[]; }

type SyncErrorKind = 'conflict' | 'rejected' | 'transient';
const classifySyncError = (error: unknown): SyncErrorKind => {
  const e = error as { message?: string; code?: string; status?: number; statusCode?: number } | null;
  const message = e?.message ?? String(error);
  const status = e?.status ?? e?.statusCode;
  if (/CONFLIT_VERSION/i.test(message)) return 'conflict';
  if (status === 401 || status === 403 || e?.code === '42501' || /permission denied|not authorized|unauthorized|forbidden/i.test(message)) return 'rejected';
  if (
    status === 400 || status === 404 || status === 409 || status === 422
    || /invalid payload|validation failed|resource .*not found|ressource .*supprimee|RESOURCE_NOT_FOUND|AUTHENTICATION_REQUIRED|OFFLINE_OPERATION_(?:INVALID|MISMATCH|INCOMPLETE)/i.test(message)
  ) return 'rejected';
  return 'transient';
};

const activeSyncIds = new Set<string>();

/** Reprend uniquement les leases qui ne correspondent a aucune operation active dans ce runtime. */
export async function recoverAbandonedSyncing(baseId?: string): Promise<number> {
  let recovered = 0;
  for (const entry of await outbox.list(baseId)) {
    if (entry.state === 'syncing' && !activeSyncIds.has(entry.id)) {
      await outbox.put({ ...entry, state: 'pending', syncingStartedAt: undefined });
      recovered++;
    }
  }
  return recovered;
}

export async function retryOutboxEntry(entryId: string): Promise<void> {
  const entry = await outbox.get(entryId);
  if (!entry) return;
  await outbox.put({ ...entry, state: 'pending', syncingStartedAt: undefined });
}

export async function discardOutboxEntry(entryId: string): Promise<void> {
  const entry = await outbox.get(entryId);
  if (!entry) return;
  await outbox.remove(entryId);
  await patchCachedEncounter(entry.baseId, entry.encounterId, (encounter) => ({ ...encounter, pending: false }));
}

// Rejoue les entrees "pending" via la RPC validee. Conflit -> entree marquee + valeur serveur
// memorisee (a resoudre) ; autre erreur -> conservee et rapportee.
export async function flushOutbox(deps: FlushDeps, baseId?: string): Promise<FlushReport> {
  assertOfflineEnabled();
  await recoverAbandonedSyncing(baseId);
  const rep: FlushReport = { synced: 0, conflicts: 0, failed: 0, errors: [] };
  for (const e of (await outbox.list(baseId)).filter((x) => x.state === 'pending')) {
    if (e.expiresAt <= Date.now() || e.ownerUserId !== currentUser) {
      await outbox.put({ ...e, state: 'expired' });
      rep.failed++; rep.errors.push(`Operation hors-ligne expiree: ${e.id}`);
      continue;
    }
    if (activeSyncIds.has(e.id)) continue;
    const attemptCount = (e.attemptCount ?? 0) + 1;
    const lastAttemptAt = Date.now();
    try {
      activeSyncIds.add(e.id);
      await outbox.put({ ...e, state: 'syncing', attemptCount, lastAttemptAt, syncingStartedAt: lastAttemptAt, lastError: undefined });
      await deps.updateEncounter(e.encounterId, e.data, e.validationStatus, e.reason, e.baseUpdatedAt, e.id);
      await outbox.put({ ...e, state: 'succeeded', attemptCount, lastAttemptAt, syncingStartedAt: undefined, lastError: undefined });
      await outbox.remove(e.id);
      const fresh = await deps.getEncounter(e.encounterId).catch(() => null);
      await patchCachedEncounter(e.baseId, e.encounterId, (c) => ({ ...c, pending: false, updatedAt: fresh?.updatedAt ?? c.updatedAt }));
      rep.synced++;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      const kind = classifySyncError(err);
      if (kind === 'conflict') {
        const server = await deps.getEncounter(e.encounterId).catch(() => null);
        await outbox.put({ ...e, state: 'conflict', attemptCount, lastAttemptAt, syncingStartedAt: undefined, lastError: m, serverData: server?.data });
        rep.conflicts++;
      } else if (kind === 'rejected') {
        await outbox.put({ ...e, state: 'rejected', attemptCount, lastAttemptAt, syncingStartedAt: undefined, lastError: m });
        rep.failed++;
        rep.errors.push(m);
      } else {
        await outbox.put({ ...e, state: 'pending', attemptCount, lastAttemptAt, syncingStartedAt: undefined, lastError: m });
        rep.failed++;
        rep.errors.push(m);
      }
    } finally {
      activeSyncIds.delete(e.id);
    }
  }
  return rep;
}

/** Anciennes entrees ou entrees expirees: jamais rejouees automatiquement. */
export async function purgeExpiredOutbox(now = Date.now()): Promise<number> {
  const all = await tx<OutboxEntry[]>(OUTBOX, 'readonly', (s) => s.getAll());
  let removed = 0;
  for (const entry of all) {
    if (entry.dataType !== 'analytic_outbox' || entry.state === 'succeeded' || !entry.ownerUserId || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
      await outbox.remove(entry.id); removed++;
    }
  }
  return removed;
}

export interface OfflinePurgeReport { indexedDb: boolean; localStorage: boolean; cacheStorage: boolean; serviceWorkers: boolean; errors: string[]; }

const OFFLINE_OWNER_KEY = 'meddata:offline-cache-owner';

/** Effacement verificable des donnees applicatives locales, sans toucher a la session d'authentification. */
export async function purgeAllOfflineData(): Promise<OfflinePurgeReport> {
  const report: OfflinePurgeReport = { indexedDb: false, localStorage: false, cacheStorage: false, serviceWorkers: false, errors: [] };
  try {
    if (typeof indexedDB !== 'undefined') await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB bloquee par un autre onglet'));
    });
    report.indexedDb = true;
  } catch (e) { report.errors.push(`IndexedDB: ${String(e)}`); }
  try {
    if (typeof localStorage !== 'undefined') for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i) ?? '';
      if (key.startsWith('meddata:') || key.startsWith('import-resume:') || key.startsWith('upload-operation:')) localStorage.removeItem(key);
    }
    report.localStorage = true;
  } catch (e) { report.errors.push(`localStorage: ${String(e)}`); }
  try { if ('caches' in globalThis) for (const key of await caches.keys()) await caches.delete(key); report.cacheStorage = true; } catch (e) { report.errors.push(`Cache Storage: ${String(e)}`); }
  try { if (typeof navigator !== 'undefined' && navigator.serviceWorker) for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister(); report.serviceWorkers = true; } catch (e) { report.errors.push(`Service worker: ${String(e)}`); }
  return report;
}

export interface OfflineInitializationReport {
  previousOwner: string | null;
  ownerChanged: boolean;
  recoveredSyncing: number;
  errors: string[];
}

export interface OfflineInitializationDeps {
  purgeAll?: () => Promise<OfflinePurgeReport>;
}

/** Point unique d'initialisation: migration, TTL, proprietaire persistant, reprise de l'outbox. */
export async function initializeOfflineForUser(
  userId: string,
  deps: OfflineInitializationDeps = {},
): Promise<OfflineInitializationReport> {
  const report: OfflineInitializationReport = { previousOwner: null, ownerChanged: false, recoveredSyncing: 0, errors: [] };
  try { const db = await openDb(); db.close(); } catch (e) { report.errors.push(`IndexedDB: ${String(e)}`); }
  try { await purgeExpiredSnapshots(); } catch (e) { report.errors.push(`Expiration snapshots: ${String(e)}`); }
  try { await purgeExpiredOutbox(); } catch (e) { report.errors.push(`Expiration outbox: ${String(e)}`); }
  try { report.previousOwner = typeof localStorage === 'undefined' ? null : localStorage.getItem(OFFLINE_OWNER_KEY); }
  catch (e) { report.errors.push(`Lecture proprietaire: ${String(e)}`); }

  report.ownerChanged = Boolean(report.previousOwner && report.previousOwner !== userId);
  if (report.ownerChanged) {
    const purge = await (deps.purgeAll ?? purgeAllOfflineData)();
    report.errors.push(...purge.errors);
  }
  if (report.errors.length) {
    try {
      if (report.previousOwner) localStorage.setItem(OFFLINE_OWNER_KEY, report.previousOwner);
    } catch (e) {
      report.errors.push(`Conservation proprietaire: ${String(e)}`);
    }
    setOfflineUser(null);
    return report;
  }
  try {
    localStorage.setItem(OFFLINE_OWNER_KEY, userId);
    setOfflineUser(userId);
    report.recoveredSyncing = await recoverAbandonedSyncing();
  } catch (e) {
    setOfflineUser(null);
    report.errors.push(`Initialisation hors-ligne: ${String(e)}`);
  }
  return report;
}

// Applique une resolution de conflit : rejeu FORCE (expected=null) de la charge retenue, puis
// nettoyage de l'outbox et du cache.
//
// L'`operationId` reste celui de l'entree, MEME si la charge a change. La tentative qui a leve le
// conflit a ete integralement ANNULEE cote serveur -- l'accuse d'idempotence et l'ecriture sont
// dans la meme transaction -- donc la cle est libre et aucune empreinte ne s'y oppose. En
// revanche, si le commit reussit et que la reponse reseau se perd, un rejeu de la MEME charge
// retrouve l'accuse et ne reecrit pas. D'ou l'exigence : la charge doit etre DETERMINISTE,
// calculee depuis la seule entree d'outbox, jamais depuis un nouvel appel reseau.
async function applyResolution(e: OutboxEntry, data: Record<string, unknown>, deps: FlushDeps): Promise<void> {
  await deps.updateEncounter(e.encounterId, data, e.validationStatus, e.reason, null, e.id);
  await outbox.remove(e.id);
  const fresh = await deps.getEncounter(e.encounterId).catch(() => null);
  await patchCachedEncounter(e.baseId, e.encounterId, (c) => ({ ...c, data, pending: false, updatedAt: fresh?.updatedAt ?? c.updatedAt }));
}

// Resolution « garder ma version » : reapplique en FORCANT (expected=null) puis nettoie.
export async function resolveKeepMine(entryId: string, deps: FlushDeps): Promise<void> {
  const e = await outbox.get(entryId);
  if (!e) return;
  await applyResolution(e, e.data, deps);
}

// Resolution « garder les deux » (L25) : union des listes de diagnostics par code -- ordre local,
// puis nouveautes serveur -- le reste de la charge restant ma version. La decision est prise par
// une fonction de domaine PURE ; ici on ne fait que la rejouer.
//
// Aucun cas particulier quand il n'y a rien a unir : la fusion vaut alors exactement ma version,
// donc l'appel se confond avec « garder ma version ». L'ecran, lui, n'offre l'issue que lorsqu'elle
// change quelque chose (`mergedKeys` non vide).
export async function resolveKeepBoth(entryId: string, deps: FlushDeps): Promise<void> {
  const e = await outbox.get(entryId);
  if (!e) return;
  await applyResolution(e, mergeKeepBoth(e.data, e.serverData).data, deps);
}

// Resolution « garder la version serveur » : abandonne ma modif, restaure la valeur serveur.
export async function resolveKeepServer(entryId: string): Promise<void> {
  const e = await outbox.get(entryId);
  if (!e) return;
  await outbox.remove(entryId);
  const sd = e.serverData;
  await patchCachedEncounter(e.baseId, e.encounterId, (c) => (sd ? { ...c, data: sd, pending: false } : { ...c, pending: false }));
}

// Hook React : liste reactive des entrees de l'outbox (se met a jour sur put/remove/flush).
export function useOutbox(baseId?: string): OutboxEntry[] {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void outbox.list(baseId).then((e) => { if (alive) setEntries(e); }).catch(() => { if (alive) setEntries([]); }); };
    refresh();
    outboxEvents?.addEventListener('change', refresh);
    return () => { alive = false; outboxEvents?.removeEventListener('change', refresh); };
  }, [baseId]);
  return entries;
}

// --- Telechargement d'une base pour le hors-ligne -------------------------------------
// Recupere TOUT (patients + rencontres + champs du gabarit) via les repos en LIGNE de
// l'utilisateur (donc soumis a la RLS), puis enregistre un instantane ANALYTIQUE.
// L'identite eventuellement renvoyee par le repo n'est jamais persistee (buildSnapshot la jette).
/** Instantane ANALYTIQUE complet renvoye en UN appel (§8 : evite le N+1 cote client). */
export interface RawSnapshotData {
  base: { id: string; name: string; templateVersionId: string | null };
  fields: OfflineField[];
  /** §5.7 : dictionnaire par version (toutes les versions presentes dans l'instantane). */
  fieldsByVersion?: Record<string, OfflineField[]>;
  rulesByVersion?: Record<string, OfflineRule[]>;
  patients: {
    id: string; code: string; templateVersionId: string; data: Record<string, unknown>;
    validationStatus: string; encounters: OfflineEncounter[];
  }[];
}

export interface SnapshotSource {
  /** §8 — chemin PREFERE : tout l'instantane en 1 requete (RPC serveur). null si pas d'acces. */
  fetchSnapshot?(baseId: string): Promise<RawSnapshotData | null>;
  // Chemin de repli (1 + N requetes), conserve pour compatibilite / tests.
  getBase(baseId: string): Promise<{ base: { id: string; name: string; currentTemplateVersionId: string | null } } | null>;
  listPatients(baseId: string): Promise<{ id: string; code: string; templateVersionId: string; data: Record<string, unknown>; validationStatus: string }[]>;
  listEncounters(patientId: string): Promise<OfflineEncounter[]>;
  getFields(versionId: string): Promise<OfflineField[]>;
}

// §7.6 : une RPC ABSENTE se reconnait au code PostgREST PGRST202 (ou au message « function ... does
// not exist » / « could not find the function »). Tout le reste (401/403, 500, payload trop gros,
// JSON invalide) n'est PAS une absence de RPC et ne doit pas declencher le repli silencieux.
function isRpcMissing(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null | undefined;
  if (err?.code === 'PGRST202' || err?.code === '42883') return true;
  return /could not find the function|function\b.*\bdoes not exist/i.test(err?.message ?? '');
}

export async function downloadBaseSnapshot(baseId: string, src: SnapshotSource, now = Date.now()): Promise<OfflineMeta> {
  assertOfflineEnabled();
  // §8 — un seul aller-retour si la source le permet (RPC download_base_snapshot). Si la RPC n'est
  // pas encore deployee sur le cloud, on retombe sur le repli N+1 : la migration reste une simple
  // OPTIMISATION, jamais une dependance bloquante.
  if (src.fetchSnapshot) {
    try {
      const s = await src.fetchSnapshot(baseId);
      if (s && s.base) {
        const byPatient: Record<string, OfflineEncounter[]> = {};
        for (const p of s.patients) byPatient[p.id] = p.encounters ?? [];
        const snap = buildSnapshot(s.base, s.patients, byPatient, s.fields ?? [], now, s.fieldsByVersion, s.rulesByVersion);
        await offlineCache.save(snap);
        return snapshotMeta(snap);
      }
      // s null / sans base -> pas d'acces : on laisse le repli ci-dessous trancher (meme verdict).
    } catch (e) {
      // §7.6 : ne retomber sur le N+1 QUE si la RPC est reellement ABSENTE (pas encore deployee).
      // Toute autre erreur (autorisation refusee, reponse trop volumineuse, erreur serveur, format
      // inattendu) doit REMONTER -> on ne masque pas une anomalie et on ne perd pas le multi-versions.
      if (!isRpcMissing(e)) throw e;
    }
  }

  // Repli : 1 requete patients + N requetes rencontres.
  const b = await src.getBase(baseId);
  if (!b) throw new Error('Base introuvable');
  const patients = await src.listPatients(baseId);
  const fields = b.base.currentTemplateVersionId ? await src.getFields(b.base.currentTemplateVersionId) : [];
  const encountersByPatient: Record<string, OfflineEncounter[]> = {};
  for (const p of patients) {
    encountersByPatient[p.id] = await src.listEncounters(p.id);
  }
  const snap = buildSnapshot(
    { id: b.base.id, name: b.base.name, templateVersionId: b.base.currentTemplateVersionId },
    patients,
    encountersByPatient,
    fields,
    now,
  );
  await offlineCache.save(snap);
  return snapshotMeta(snap);
}

// --- Hook React : etat en ligne / hors-ligne (reagit aux evenements du navigateur) ------
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(isOnline());
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
