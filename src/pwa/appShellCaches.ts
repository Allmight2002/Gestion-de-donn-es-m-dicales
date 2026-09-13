/**
 * Frontiere entre les DEUX couches locales de MedData.
 *
 * Couche 1 — la coquille applicative : HTML, JavaScript, CSS, icones, traductions. Elle ne
 * contient aucune donnee utilisateur et n'est liee a aucune session : c'est ce qui permet a
 * l'application de demarrer sans reseau, y compris sans session restaurable.
 *
 * Couche 2 — les donnees locales : instantanes cliniques, file de synchronisation, brouillons,
 * contexte de saisie, marqueur de proprietaire. Elles vivent dans IndexedDB et localStorage,
 * et la deconnexion les efface.
 *
 * La purge de deconnexion emportait aussi la couche 1 : le service worker etait desinstalle et
 * tout le Cache Storage vide. Une session non restaurable au demarrage hors connexion suffisait
 * alors a laisser le navigateur sur `ERR_FAILED`, faute de coquille a servir.
 *
 * Tout cache qui porterait un jour du contenu utilisateur doit rester HORS de cette liste :
 * ce qui n'est pas reconnu comme coquille est efface a la deconnexion.
 */
const APP_SHELL_CACHE_PATTERNS = [
  // Precache Workbox : index.html et les fichiers versionnes de la coquille.
  /^workbox-precache/,
  // Reserve aux caches de coquille que l'application nommerait elle-meme.
  /^meddata-shell/,
];

export function isAppShellCache(cacheName: string): boolean {
  return APP_SHELL_CACHE_PATTERNS.some((pattern) => pattern.test(cacheName));
}

/** Les caches a effacer : tout ce qui n'est pas la coquille applicative. */
export function userDataCaches(cacheNames: readonly string[]): string[] {
  return cacheNames.filter((name) => !isAppShellCache(name));
}
