// A4 — brouillon LOCAL de saisie en cours (anti-perte). Si l'onglet se ferme, l'app plante ou le
// reseau tombe, la saisie non enregistree est recuperee au retour sur le meme formulaire.
//
// SECURITE : ne stocke QUE des donnees ANALYTIQUES (jamais d'identite) — meme principe que la
// couche hors-ligne. Partitionne par UTILISATEUR courant (poste partage) : un autre compte ne
// retrouve pas le brouillon d'un tiers. Ephemere : efface a l'enregistrement reussi. Best-effort
// (localStorage indisponible / quota -> no-op silencieux, jamais bloquant pour la saisie).
import { getOfflineUser } from './offline';

const PREFIX = 'meddata:draft';
export const DRAFT_TTL_MS = 72 * 3600 * 1000; // 72 heures
const keyOf = (kind: string, id: string): string => `${PREFIX}:${kind}:${getOfflineUser() ?? ''}:${id}`;

export interface DraftEnvelope<T> {
  at: number; // epoch ms de la derniere sauvegarde
  data: T;
}

export function isDraftExpired(draft: { at: number }, now = Date.now()): boolean {
  return !Number.isFinite(draft.at) || now - draft.at > DRAFT_TTL_MS;
}

function draftUserFromKey(key: string): string | null {
  if (!key.startsWith(`${PREFIX}:`)) return null;
  const parts = key.split(':');
  return parts.length >= 5 ? parts[3] : null;
}

function draftKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(`${PREFIX}:`)) keys.push(key);
  }
  return keys;
}

export function saveDraft<T>(kind: string, id: string, data: T): void {
  try {
    localStorage.setItem(keyOf(kind, id), JSON.stringify({ at: Date.now(), data }));
  } catch { /* localStorage indisponible ou quota depasse */ }
}

export function loadDraft<T>(kind: string, id: string): DraftEnvelope<T> | null {
  try {
    const key = keyOf(kind, id);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as DraftEnvelope<T>;
    if (!draft || typeof draft.at !== 'number' || isDraftExpired(draft)) {
      localStorage.removeItem(key);
      return null;
    }
    return draft;
  } catch { return null; }
}

export function clearDraft(kind: string, id: string): void {
  try {
    localStorage.removeItem(keyOf(kind, id));
  } catch { /* no-op */ }
}

export function purgeExpiredDrafts(now = Date.now()): number {
  try {
    let removed = 0;
    for (const key of draftKeys()) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const draft = JSON.parse(raw) as DraftEnvelope<unknown>;
      if (!draft || typeof draft.at !== 'number' || isDraftExpired(draft, now)) {
        localStorage.removeItem(key);
        removed += 1;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

export function clearDraftsForCurrentUser(userId = getOfflineUser()): number {
  try {
    const targetUser = userId ?? '';
    let removed = 0;
    for (const key of draftKeys()) {
      if (draftUserFromKey(key) === targetUser) {
        localStorage.removeItem(key);
        removed += 1;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
