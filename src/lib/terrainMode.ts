// Audit UI mobile, lot 8 : mode « Terrain ». Preference d'AFFICHAGE propre a l'appareil
// (localStorage), comme le theme : elle ne contient ni donnee clinique ni donnee personnelle,
// et elle ne change aucun droit. Dans une base, elle ne laisse au premier niveau que l'onglet
// Patients ; les autres destinations restent atteignables dans « Plus ».
import { useSyncExternalStore } from 'react';

const KEY = 'meddata:terrain';
const CHANGE_EVENT = 'meddata:terrain-change';
// Stockage refuse (navigation privee, quota) : la preference vaut pour la session courante.
let unsaved: boolean | null = null;

export function getTerrainMode(): boolean {
  if (unsaved !== null) return unsaved;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setTerrainMode(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
    unsaved = null;
  } catch {
    unsaved = enabled;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  // Un autre onglet du meme appareil change la preference : cet onglet suit.
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) onChange(); };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTerrainMode(): [boolean, (enabled: boolean) => void] {
  return [useSyncExternalStore(subscribe, getTerrainMode, () => false), setTerrainMode];
}
