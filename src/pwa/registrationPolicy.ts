let registrationAllowed = false;
let cleanupRequired = false;
let cleanupEpoch = 0;
let cleanupInFlight: Promise<boolean> | null = null;
const lateRegistrations = new Set<ServiceWorkerRegistration>();

/** L'autorisation suit la session et n'est armee qu'apres la purge inter-compte. */
export function setPwaRegistrationAllowed(allowed: boolean): void {
  registrationAllowed = allowed;
}

export function isPwaRegistrationAllowed(): boolean {
  return registrationAllowed;
}

async function drainLateCleanup(): Promise<boolean> {
  if (!cleanupRequired) return true;
  if (cleanupInFlight) return cleanupInFlight;

  cleanupInFlight = (async () => {
    // Un callback peut arriver pendant le nettoyage. La boucle reprend alors avec le nouvel epoch.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const epoch = cleanupEpoch;
      try {
        const registrations = new Set(lateRegistrations);
        if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
          for (const current of await navigator.serviceWorker.getRegistrations()) registrations.add(current);
        }
        for (const current of registrations) await current.unregister();
        if ('caches' in globalThis) {
          for (const key of await caches.keys()) await caches.delete(key);
        }
        if (epoch === cleanupEpoch) {
          lateRegistrations.clear();
          cleanupRequired = false;
          return true;
        }
      } catch {
        // Aucun detail navigateur potentiellement sensible dans les logs.
        console.warn('[pwa] Nettoyage tardif incomplet; registration maintenue desarmee.');
        cleanupRequired = true;
        return false;
      }
    }
    console.warn('[pwa] Nettoyage tardif instable; registration maintenue desarmee.');
    cleanupRequired = true;
    return false;
  })().finally(() => { cleanupInFlight = null; });

  return cleanupInFlight;
}

/** Arme la PWA seulement si la session est toujours courante et le nettoyage tardif est termine. */
export async function authorizePwaRegistrationAfterCleanup(isCurrent: () => boolean): Promise<boolean> {
  registrationAllowed = false;
  const clean = await drainLateCleanup();
  if (!clean || cleanupRequired || !isCurrent()) return false;
  registrationAllowed = true;
  return true;
}

/**
 * Ferme une registration Workbox terminee apres un logout. La purge principale a deja ete
 * executee ; ce second nettoyage couvre uniquement la course asynchrone de registration.
 */
export async function discardPwaRegistrationIfDisallowed(
  registration: ServiceWorkerRegistration | undefined,
): Promise<boolean> {
  if (registrationAllowed || !registration) return false;
  lateRegistrations.add(registration);
  cleanupRequired = true;
  cleanupEpoch += 1;
  return drainLateCleanup();
}
