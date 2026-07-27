// F7 — copie locale du referentiel de diagnostics.
//
// POURQUOI. Sans elle, chaque frappe part au serveur : inutilisable sur une connexion lente
// et impossible hors ligne. Le referentiel etant fige entre deux publications, il se prete
// naturellement a une copie locale.
//
// BASE SEPAREE, ET C'EST DELIBERE. Cette copie ne vit PAS dans `meddata-offline`, qui
// heberge les donnees patient. Deux raisons :
//  * un referentiel de diagnostics n'est pas une donnee medicale — c'est un dictionnaire.
//    Le meler aux instantanes patient brouillerait le cloisonnement que le produit protege ;
//  * la base patient est purgee a chaque changement d'utilisateur et desactivee par la
//    politique hors-ligne. Le referentiel y serait efface sans aucune raison.
//
// Aucune donnee de patient n'entre ici, jamais.
import type { TerminologyEntry, TerminologyOption, TerminologyRepository } from './terminology';

const DB_NAME = 'meddata-terminology';
const DB_VERSION = 1;
const ENTRIES = 'entries';
const META = 'meta';
const META_KEY = 'release';
/** Taille de page du telechargement : compromis entre nombre d'allers-retours et memoire. */
const PAGE = 1000;

export interface CacheStatus {
  slug: string;
  version: string;
  count: number;
  cachedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB indisponible'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'code' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result: T;
    const req = fn(t.objectStore(store));
    req.onsuccess = () => { result = req.result as T; };
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

/**
 * Normalisation IDENTIQUE a celle du serveur (`terminology_normalize`) : minuscules,
 * accents ramenes a la lettre de base, apostrophes typographiques uniformisees.
 *
 * Elle ne s'applique QU'A LA SAISIE de l'utilisateur : les libelles, eux, arrivent avec
 * leur `searchText` deja calcule par la base. Une divergence ici ferait diverger les
 * resultats locaux de ceux du serveur, ce qui serait pire qu'une absence de copie.
 */
export function normalizeQuery(texte: string): string {
  // L'ordre suit celui du serveur : minuscules D'ABORD, puis les substitutions. Traiter
  // les ligatures avant `toLowerCase` laisserait passer les majuscules — c'est exactement
  // le defaut qui avait ete corrige cote base pour les lettres accentuees.
  return texte
    .replace(/[’ʼ]/g, "'")
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'o')
    .replace(/æ/g, 'a');
}

/** Etat de la copie locale, ou null si absente. */
export async function cacheStatus(): Promise<CacheStatus | null> {
  try {
    const meta = await tx<CacheStatus & { key: string } | undefined>(META, 'readonly', (s) => s.get(META_KEY));
    return meta ? { slug: meta.slug, version: meta.version, count: meta.count, cachedAt: meta.cachedAt } : null;
  } catch {
    return null;
  }
}

/** Supprime la copie locale. */
export async function clearCache(): Promise<void> {
  try {
    await tx(META, 'readwrite', (s) => s.clear());
    await tx(ENTRIES, 'readwrite', (s) => s.clear());
    memoire = null;
  } catch { /* une copie absente n'a pas besoin d'etre effacee */ }
}

/**
 * Telecharge le referentiel actif et le stocke localement.
 * `onProgress` recoit le nombre d'entrees deja ecrites, pour informer l'utilisateur : sur
 * une connexion lente l'operation dure, et une barre figee ferait croire a un blocage.
 */
export async function downloadReference(
  repo: TerminologyRepository,
  onProgress?: (recus: number, total: number) => void,
): Promise<CacheStatus> {
  const release = await repo.activeRelease();
  if (!release) throw new Error('Aucun référentiel actif à télécharger.');

  await clearCache();
  let offset = 0;
  let total = 0;
  for (;;) {
    const page = await repo.listEntries(offset, PAGE);
    if (page.length === 0) break;
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(ENTRIES, 'readwrite');
      const store = t.objectStore(ENTRIES);
      for (const e of page) store.put(e);
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
    total += page.length;
    offset += page.length;
    onProgress?.(total, release.conceptCount);
    if (page.length < PAGE) break;
  }

  const status: CacheStatus = { slug: release.slug, version: release.version, count: total, cachedAt: Date.now() };
  await tx(META, 'readwrite', (s) => s.put({ key: META_KEY, ...status }));
  memoire = null;
  return status;
}

/** La copie est-elle celle du referentiel actuellement actif ? */
export async function cacheIsCurrent(repo: TerminologyRepository): Promise<boolean> {
  const [local, distant] = await Promise.all([cacheStatus(), repo.activeRelease()]);
  if (!local || !distant) return false;
  return local.slug === distant.slug && local.version === distant.version;
}

// Les entrees sont relues une fois puis gardees en memoire : relire IndexedDB a chaque
// frappe annulerait le benefice de la copie.
let memoire: TerminologyEntry[] | null = null;

async function entrees(): Promise<TerminologyEntry[]> {
  if (memoire) return memoire;
  const toutes = await tx<TerminologyEntry[]>(ENTRIES, 'readonly', (s) => s.getAll());
  memoire = toutes ?? [];
  return memoire;
}

/**
 * Recherche dans la copie locale, avec le MEME classement que le serveur : ce qui commence
 * par la saisie d'abord, puis le libelle le plus court. Un classement different donnerait
 * des propositions differentes selon que l'on est en ligne ou non.
 */
export async function searchLocal(query: string, limit = 20): Promise<TerminologyOption[]> {
  const needle = normalizeQuery(query.trim());
  if (needle.length < 2) return [];
  const toutes = await entrees();

  const trouves = toutes.filter((e) => e.searchText.includes(needle));
  trouves.sort((a, b) => {
    const pa = a.searchText.startsWith(needle) ? 0 : 1;
    const pb = b.searchText.startsWith(needle) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.label.length !== b.label.length) return a.label.length - b.label.length;
    return a.label.localeCompare(b.label);
  });

  return trouves.slice(0, limit).map((e) => ({
    id: e.code, code: e.code, label: e.label, kind: 'category', depth: 0,
  }));
}
