// Le contrat de la coquille applicative : ce qui doit etre vrai pour qu'un demarrage a froid
// sans reseau aboutisse, et ce que la purge de deconnexion a le droit d'emporter.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { checkAppShellReady, resetAppShellForTests } from './appShell';
import { isAppShellCache, userDataCaches } from './appShellCaches';

function stubServiceWorker(value: unknown): void {
  Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
}

const activeRegistration = { active: {} } as ServiceWorkerRegistration;

describe('coquille applicative — classement des caches', () => {
  test('le precache et les caches de coquille survivent, tout le reste part', () => {
    expect(isAppShellCache('workbox-precache-v2-https://meddata.test/')).toBe(true);
    expect(isAppShellCache('meddata-shell-assets')).toBe(true);
    // Un futur cache de reponses serveur n'est PAS une coquille : il doit partir avec les donnees.
    expect(isAppShellCache('meddata-api-responses')).toBe(false);
    expect(isAppShellCache('meddata-i18n')).toBe(false);

    expect(userDataCaches([
      'workbox-precache-v2-https://meddata.test/',
      'meddata-api-responses',
      'images-cliniques',
    ])).toEqual(['meddata-api-responses', 'images-cliniques']);
  });
});

describe('coquille applicative — preparation hors-ligne', () => {
  beforeEach(() => {
    resetAppShellForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAppShellForTests();
  });

  test('un navigateur sans service worker le dit au lieu de promettre le hors-ligne', async () => {
    // @ts-expect-error suppression volontaire de la capacite pour le test
    delete navigator.serviceWorker;
    vi.stubGlobal('caches', { match: vi.fn(async () => undefined) });
    expect(await checkAppShellReady()).toEqual({ ready: false, missing: ['unsupported'] });
  });

  test('sans registration, la disponibilite hors-ligne n est pas acquise', async () => {
    stubServiceWorker({ getRegistration: vi.fn(async () => undefined), ready: Promise.resolve(activeRegistration) });
    vi.stubGlobal('caches', { match: vi.fn(async () => undefined) });
    const readiness = await checkAppShellReady();
    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toContain('not_registered');
    expect(readiness.missing).toContain('shell_not_cached');
  });

  test('une registration sans worker actif ne suffit pas', async () => {
    stubServiceWorker({
      getRegistration: vi.fn(async () => ({ active: null } as unknown as ServiceWorkerRegistration)),
      // `ready` ne resout pas : l'activation n'est pas acquise, la borne tranche.
      ready: new Promise(() => undefined),
    });
    vi.stubGlobal('caches', { match: vi.fn(async () => new Response('<html></html>')) });
    vi.useFakeTimers();
    const pending = checkAppShellReady();
    await vi.advanceTimersByTimeAsync(11_000);
    const readiness = await pending;
    vi.useRealTimers();
    expect(readiness).toEqual({ ready: false, missing: ['not_activated'] });
  });

  test('un worker actif mais sans coquille precachee ne promet rien non plus', async () => {
    stubServiceWorker({ getRegistration: vi.fn(async () => activeRegistration), ready: Promise.resolve(activeRegistration) });
    vi.stubGlobal('caches', { match: vi.fn(async () => undefined) });
    expect(await checkAppShellReady()).toEqual({ ready: false, missing: ['shell_not_cached'] });
  });

  test('worker actif et index.html precache : la promesse tient', async () => {
    stubServiceWorker({ getRegistration: vi.fn(async () => activeRegistration), ready: Promise.resolve(activeRegistration) });
    // Le precache indexe index.html avec son empreinte de revision : la recherche doit
    // ignorer la chaine de requete, sinon une coquille bien presente passerait pour absente.
    const match = vi.fn(async (_request: string, options?: CacheQueryOptions) => (
      options?.ignoreSearch ? new Response('<html></html>') : undefined
    ));
    vi.stubGlobal('caches', { match });
    expect(await checkAppShellReady()).toEqual({ ready: true, missing: [] });
    expect(match).toHaveBeenCalledWith('/index.html', { ignoreSearch: true });
  });
});
