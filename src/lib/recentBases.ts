// UI-1 — bases recemment ouvertes (affichees dans la barre laterale). Stocke en localStorage,
// PARTITIONNE PAR UTILISATEUR (poste partage), 4 entrees max. Ecrit par l'ecran d'une base
// (nom deja connu -> aucun appel reseau) ; lu par la barre laterale a chaque rendu.
import { getOfflineUser } from '../data/offline';

export interface RecentBase {
  id: string;
  name: string;
}

const MAX = 4;
const key = () => `meddata:recent-bases:${getOfflineUser() ?? ''}`;

export function recentBases(): RecentBase[] {
  try {
    const raw = localStorage.getItem(key());
    const list = raw ? (JSON.parse(raw) as RecentBase[]) : [];
    return Array.isArray(list) ? list.filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string') : [];
  } catch {
    return [];
  }
}

export function recordRecentBase(id: string, name: string): void {
  try {
    const list = [{ id, name }, ...recentBases().filter((b) => b.id !== id)].slice(0, MAX);
    localStorage.setItem(key(), JSON.stringify(list));
  } catch { /* stockage indisponible : pas de liste recente */ }
}
