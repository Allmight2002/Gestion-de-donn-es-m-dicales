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
      })),
    })),
    cachedAt: now,
    expiresAt: now + OFFLINE_TTL_MS,
  };
}

export const snapshotMeta = (s: OfflineSnapshot): OfflineMeta => ({
  baseId: s.baseId, baseName: s.baseName, cachedAt: s.cachedAt, expiresAt: s.expiresAt, patientCount: s.patients.length,
});

// --- IndexedDB (un seul object store, cle = baseId) -------------------------------------
const DB_NAME = 'meddata-offline';
const DB_VERSION = 1;
const STORE = 'snapshots';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'baseId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Execute une transaction et resout APRES le commit (durabilite), avec le resultat de la requete.
function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        let result: T;
        const req = fn(t.objectStore(STORE));
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
  async save(snap) { await tx('readwrite', (s) => s.put(snap)); },
  async get(baseId) { return (await tx<OfflineSnapshot | undefined>('readonly', (s) => s.get(baseId))) ?? null; },
  async list() { return (await tx<OfflineSnapshot[]>('readonly', (s) => s.getAll())).map(snapshotMeta); },
  async remove(baseId) { await tx('readwrite', (s) => s.delete(baseId)); },
};

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
