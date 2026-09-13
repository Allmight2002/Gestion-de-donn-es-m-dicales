/**
 * Coquille applicative — enregistree au DEMARRAGE, avant toute question d'authentification.
 *
 * L'enregistrement dependait auparavant d'une session Supabase valide, d'un profil charge et
 * d'une autorisation armee apres purge. Le service worker etait donc traite comme une ressource
 * de session alors qu'il ne sert qu'a faire exister l'application : sans session restaurable au
 * lancement hors connexion, il n'y avait plus de coquille du tout, et le navigateur affichait
 * `ERR_FAILED`. L'authentification decide de QUELLES DONNEES sont accessibles, jamais si
 * l'application peut demarrer.
 */

/**
 * Fonction d'enregistrement fournie par le module virtuel de vite-plugin-pwa. Elle est
 * INJECTEE depuis le point d'entree : importee ici, elle entrerait dans le graphe de tout
 * ecran qui consulte l'etat de la coquille, et ce module virtuel ne se resout pas hors du
 * build (les tests de ces ecrans echouaient au chargement, avant le premier rendu).
 */
export interface AppShellRegistrar {
  (options: {
    onNeedRefresh?: () => void;
    onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }): (reloadPage?: boolean) => Promise<void>;
}

export interface AppShellState {
  /** Une nouvelle version attend une decision explicite de l'utilisateur. */
  needRefresh: boolean;
  registration: ServiceWorkerRegistration | null;
}

/** Ce qui manque pour qu'un demarrage a froid sans reseau soit garanti. */
export type AppShellRequirement =
  | 'unsupported'
  | 'not_registered'
  | 'not_activated'
  | 'shell_not_cached';

export interface AppShellReadiness {
  ready: boolean;
  missing: AppShellRequirement[];
}

/** Au-dela, l'activation est consideree comme non acquise plutot que d'attendre indefiniment. */
const ACTIVATION_TIMEOUT_MS = 10_000;

let state: AppShellState = { needRefresh: false, registration: null };
const listeners = new Set<() => void>();
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let registered = false;

function publish(next: Partial<AppShellState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function subscribeAppShell(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Reference stable entre deux notifications : `useSyncExternalStore` l'exige. */
export function getAppShellState(): AppShellState {
  return state;
}

/**
 * Enregistre le service worker. Idempotent : un second appel ne cree pas de seconde
 * registration, de sorte que le rechargement d'un module en developpement reste sans effet.
 */
export function registerAppShell(register: AppShellRegistrar): void {
  if (registered) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  registered = true;
  updateSW = register({
    onNeedRefresh() { publish({ needRefresh: true }); },
    onRegisteredSW(_swUrl, registration) { publish({ registration: registration ?? null }); },
    onRegisterError() {
      // Aucun detail navigateur dans les journaux : l'absence de coquille se lit deja dans
      // l'etat de preparation hors-ligne, qui est la ou l'utilisateur en a besoin.
      publish({ registration: null });
    },
  });
}

/** Active la version en attente et recharge la page. */
export async function applyAppShellUpdate(): Promise<void> {
  if (!updateSW) throw new Error('APP_SHELL_NOT_REGISTERED');
  await updateSW(true);
}

async function activated(registration: ServiceWorkerRegistration): Promise<boolean> {
  if (registration.active) return true;
  // `ready` ne resout qu'une fois un worker actif ; la borne evite d'attendre sans fin une
  // activation qui n'arrivera pas (installation en echec, worker bloque).
  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => { setTimeout(() => resolve(null), ACTIVATION_TIMEOUT_MS); }),
  ]);
  return Boolean(ready?.active);
}

/**
 * Verifie ce qu'une base « disponible hors-ligne » suppose reellement : que l'application
 * elle-meme sache redemarrer sans reseau. L'instantane en IndexedDB n'y suffit pas — sans
 * coquille precachee, le navigateur n'atteint meme pas le code qui saurait le lire.
 */
export async function checkAppShellReady(): Promise<AppShellReadiness> {
  const missing: AppShellRequirement[] = [];
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('caches' in globalThis)) {
    return { ready: false, missing: ['unsupported'] };
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) missing.push('not_registered');
    else if (!await activated(registration)) missing.push('not_activated');
  } catch {
    missing.push('not_registered');
  }
  try {
    // Le precache Workbox indexe index.html avec son empreinte de revision en parametre :
    // la recherche doit donc ignorer la chaine de requete pour le retrouver.
    const shell = await caches.match('/index.html', { ignoreSearch: true })
      ?? await caches.match('/', { ignoreSearch: true });
    if (!shell) missing.push('shell_not_cached');
  } catch {
    missing.push('shell_not_cached');
  }
  return { ready: missing.length === 0, missing };
}

/** Reservee aux tests : remet le module dans son etat initial. */
export function resetAppShellForTests(): void {
  state = { needRefresh: false, registration: null };
  listeners.clear();
  updateSW = null;
  registered = false;
}
