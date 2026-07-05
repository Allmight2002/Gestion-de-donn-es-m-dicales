// UI-1 — Mode d'affichage clair / sombre / systeme. Le choix est PERSISTE par appareil
// (localStorage) et applique via la classe `dark` sur <html> (variante Tailwind, cf. index.css).
// « systeme » suit la preference de l'OS et se met a jour EN DIRECT si elle change. Applique
// avant le rendu React (main.tsx) -> pas d'eclair de mauvais theme.
export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'meddata:theme';
// Couleur de la barre navigateur/PWA (meta theme-color) accordee au theme.
const META_COLOR = { light: '#0f766e', dark: '#0f172a' } as const;

export function getTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(mode: ThemeMode): void {
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? META_COLOR.dark : META_COLOR.light);
}

export function setTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch { /* stockage indisponible : le theme vaut pour la session courante */ }
  apply(mode);
}

/** A appeler UNE fois au demarrage : applique le theme persiste + suit l'OS en mode systeme. */
export function initTheme(): void {
  apply(getTheme());
  if (typeof matchMedia !== 'undefined') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (getTheme() === 'system') apply('system');
    });
  }
}
