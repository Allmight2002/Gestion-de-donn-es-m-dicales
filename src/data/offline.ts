// Cache HORS-LIGNE (Phase 1, lecture seule). Stocke un INSTANTANE ANALYTIQUE d'une base
// (patients + rencontres) dans IndexedDB, pour CONSULTER la base sans reseau.
//
// SECURITE — separation des zones jusque sur l'appareil : l'instantane ne contient JAMAIS
// l'IDENTITE (nom, date de naissance) ni les IMAGES. `buildSnapshot` ne recopie que les champs
// analytiques, meme si on lui passe un patient complet -> garantie par construction. L'identite
// reste accessible UNIQUEMENT en ligne (via la RLS).
import { useEffect, useState } from 'react';

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
  displayOrder: number;
}

export interface OfflineSnapshot {
  baseId: string;
  baseName: string;
  templateVersionId: string | null;
  fields: OfflineField[];
  patients: OfflinePatient[];
  cachedAt: number; // epoch ms
  expiresAt: number; // epoch ms
}

/** Metadonnees legeres d'un instantane (sans la liste des patients). */
export interface OfflineMeta {
  baseId: string;
  baseName: string;
  cachedAt: number;
  expiresAt: number;
  patientCount: number;
}

export const OFFLINE_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function isExpired(snap: { expiresAt: number }, now = Date.now()): boolean {
  return now > snap.expiresAt;
}

// Construit un instantane ANALYTIQUE : ne retient QUE les champs analytiques (aucune identite).
export function buildSnapshot(
  base: { id: string; name: string; templateVersionId: string | null },
  patients: { id: string; code: string; templateVersionId: string; data: Record<string, unknown>; validationStatus: string }[],
  encountersByPatient: Record<string, OfflineEncounter[]>,
  fields: OfflineField[] = [],
  now = Date.now(),
): OfflineSnapshot {
  return {
    baseId: base.id,
    baseName: base.name,
    templateVersionId: base.templateVersionId,
    fields: fields.map((f) => ({
      id: f.id, fieldKey: f.fieldKey, label: f.label, scope: f.scope, type: f.type, displayOrder: f.displayOrder,
    })),
    patients: patients.map((p) => ({
      id: p.id,
      code: p.code,
      templateVersionId: p.templateVersionId,
      data: p.data,
      validationStatus: p.validationStatus,
      encounters: (encountersByPatient[p.id] ?? []).map((e) => ({
        id: e.id, encounterType: e.encounterType, encounterDate: e.encounterDate,
        validationStatus: e.validationStatus, ageValue: e.ageValue, ageUnit: e.ageUnit, data: e.data,
        updatedAt: e.updatedAt ?? null,
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
const DB_VERSION = 2;
const STORE = 'snapshots';
const OUTBOX = 'outbox';

function openDb(): Promise<IDBDatabase> {
  // IndexedDB peut etre absent (SSR, vieux navigateur, environnement de test sans polyfill).
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB indisponible'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'baseId' });
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
  async save(snap) { await tx(STORE, 'readwrite', (s) => s.put(snap)); },
  async get(baseId) { return (await tx<OfflineSnapshot | undefined>(STORE, 'readonly', (s) => s.get(baseId))) ?? null; },
  async list() { return (await tx<OfflineSnapshot[]>(STORE, 'readonly', (s) => s.getAll())).map(snapshotMeta); },
  async remove(baseId) { await tx(STORE, 'readwrite', (s) => s.delete(baseId)); },
};

// =====================================================================================
// OUTBOX — file d'attente des ECRITURES preparees hors-ligne (Phases 2/3).
// Seul l'ANALYTIQUE est concerne (corrections de rencontres) ; jamais l'identite/images.
// La synchronisation rejoue chaque entree via la MEME RPC validee (update_encounter), avec
// un verrou optimiste (baseUpdatedAt) -> aucune voie d'ecriture parallele, integrite preservee.
// =====================================================================================
export interface OutboxEntry {
  id: string;
  baseId: string;
  patientId: string;
  encounterId: string;
  data: Record<string, unknown>;     // nouvelle valeur analytique
  reason: string;                    // motif de correction (requis)
  validationStatus: string;          // statut cible de la rencontre
  baseUpdatedAt: string | null;      // jeton optimiste = version vue hors-ligne
  createdAt: number;
  state: 'pending' | 'conflict';
  serverData?: Record<string, unknown>; // valeur serveur (renseignee en cas de conflit, pour l'UI)
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
    const all = await tx<OutboxEntry[]>(OUTBOX, 'readonly', (s) => s.getAll());
    return (baseId ? all.filter((e) => e.baseId === baseId) : all).sort((a, b) => a.createdAt - b.createdAt);
  },
  async get(id: string): Promise<OutboxEntry | null> { return (await tx<OutboxEntry | undefined>(OUTBOX, 'readonly', (s) => s.get(id))) ?? null; },
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
  const entry: OutboxEntry = { id: newId(), createdAt: Date.now(), state: 'pending', ...input };
  await outbox.put(entry);
  await patchCachedEncounter(input.baseId, input.encounterId, (e) => ({
    ...e, data: input.data, validationStatus: input.validationStatus, pending: true,
  }));
  return entry;
}

export interface FlushDeps {
  updateEncounter(encounterId: string, data: Record<string, unknown>, status: string, reason: string, expectedUpdatedAt: string | null): Promise<unknown>;
  getEncounter(encounterId: string): Promise<{ data: Record<string, unknown>; updatedAt?: string | null } | null>;
}
export interface FlushReport { synced: number; conflicts: number; failed: number; errors: string[]; }

const isConflict = (m: string) => /CONFLIT_VERSION/i.test(m);

// Rejoue les entrees "pending" via la RPC validee. Conflit -> entree marquee + valeur serveur
// memorisee (a resoudre) ; autre erreur -> conservee et rapportee.
export async function flushOutbox(deps: FlushDeps, baseId?: string): Promise<FlushReport> {
  const rep: FlushReport = { synced: 0, conflicts: 0, failed: 0, errors: [] };
  for (const e of (await outbox.list(baseId)).filter((x) => x.state === 'pending')) {
    try {
      await deps.updateEncounter(e.encounterId, e.data, e.validationStatus, e.reason, e.baseUpdatedAt);
      await outbox.remove(e.id);
      const fresh = await deps.getEncounter(e.encounterId).catch(() => null);
      await patchCachedEncounter(e.baseId, e.encounterId, (c) => ({ ...c, pending: false, updatedAt: fresh?.updatedAt ?? c.updatedAt }));
      rep.synced++;
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (isConflict(m)) {
        const server = await deps.getEncounter(e.encounterId).catch(() => null);
        await outbox.put({ ...e, state: 'conflict', serverData: server?.data });
        rep.conflicts++;
      } else {
        rep.failed++;
        rep.errors.push(m);
      }
    }
  }
  return rep;
}

// Resolution « garder ma version » : reapplique en FORCANT (expected=null) puis nettoie.
export async function resolveKeepMine(entryId: string, deps: FlushDeps): Promise<void> {
  const e = await outbox.get(entryId);
  if (!e) return;
  await deps.updateEncounter(e.encounterId, e.data, e.validationStatus, e.reason, null);
  await outbox.remove(entryId);
  const fresh = await deps.getEncounter(e.encounterId).catch(() => null);
  await patchCachedEncounter(e.baseId, e.encounterId, (c) => ({ ...c, data: e.data, pending: false, updatedAt: fresh?.updatedAt ?? c.updatedAt }));
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
export interface SnapshotSource {
  getBase(baseId: string): Promise<{ base: { id: string; name: string; currentTemplateVersionId: string | null } } | null>;
  listPatients(baseId: string): Promise<{ id: string; code: string; templateVersionId: string; data: Record<string, unknown>; validationStatus: string }[]>;
  listEncounters(patientId: string): Promise<OfflineEncounter[]>;
  getFields(versionId: string): Promise<OfflineField[]>;
}

export async function downloadBaseSnapshot(baseId: string, src: SnapshotSource, now = Date.now()): Promise<OfflineMeta> {
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
