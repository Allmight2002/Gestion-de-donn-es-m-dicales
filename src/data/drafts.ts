// A4 — brouillon LOCAL de saisie en cours (anti-perte). Si l'onglet se ferme, l'app plante ou le
// reseau tombe, la saisie non enregistree est recuperee au retour sur le meme formulaire.
//
// SECURITE : ne stocke QUE des donnees ANALYTIQUES (jamais d'identite) — meme principe que la
// couche hors-ligne. Partitionne par UTILISATEUR courant (poste partage) : un autre compte ne
// retrouve pas le brouillon d'un tiers. Ephemere : efface a l'enregistrement reussi. Best-effort
// (localStorage indisponible / quota -> no-op silencieux, jamais bloquant pour la saisie).
import { getOfflineUser } from './offline';

const PREFIX = 'meddata:draft';
const keyOf = (kind: string, id: string): string => `${PREFIX}:${kind}:${getOfflineUser() ?? ''}:${id}`;

export interface DraftEnvelope<T> {
  at: number; // epoch ms de la derniere sauvegarde
  data: T;
}

export function saveDraft<T>(kind: string, id: string, data: T): void {
  try {
    localStorage.setItem(keyOf(kind, id), JSON.stringify({ at: Date.now(), data }));
  } catch { /* localStorage indisponible ou quota depasse */ }
}

export function loadDraft<T>(kind: string, id: string): DraftEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(keyOf(kind, id));
    return raw ? (JSON.parse(raw) as DraftEnvelope<T>) : null;
  } catch { return null; }
}

export function clearDraft(kind: string, id: string): void {
  try {
    localStorage.removeItem(keyOf(kind, id));
  } catch { /* no-op */ }
}
