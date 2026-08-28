import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider';
import { AuthenticatedPwaUpdatePrompt, PWA_REMIND_LATER_MS, PwaUpdatePrompt } from './PwaUpdatePrompt';
import {
  authorizePwaRegistrationAfterCleanup,
  discardPwaRegistrationIfDisallowed,
  isPwaRegistrationAllowed,
  setPwaRegistrationAllowed,
} from '../pwa/registrationPolicy';

const pwa = vi.hoisted(() => ({
  updateServiceWorker: vi.fn(async () => undefined),
  useRegisterSW: vi.fn(),
  onRegisteredSW: undefined as undefined | ((url: string, registration: ServiceWorkerRegistration | undefined) => void),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: { onRegisteredSW?: typeof pwa.onRegisteredSW }) => {
    pwa.useRegisterSW(options);
    pwa.onRegisteredSW = options?.onRegisteredSW;
    return {
      needRefresh: [true, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: pwa.updateServiceWorker,
    };
  },
}));

const renderPrompt = () => render(<I18nProvider><PwaUpdatePrompt /></I18nProvider>);

const authValue = (signedIn: boolean, userId = 'user-fictif'): AuthContextValue => ({
  status: signedIn ? 'signed_in' : 'signed_out',
  user: signedIn ? { id: userId, email: 'user@demo.test' } : null,
  profile: signedIn ? { id: userId, fullName: 'Utilisateur fictif', globalRole: 'medecin', language: 'fr' } : null,
  error: null,
  busy: false,
  signIn: vi.fn(async () => true),
  signOut: vi.fn(async () => undefined),
  sendPasswordReset: vi.fn(async () => true),
  updatePassword: vi.fn(async () => true),
});

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPwaRegistrationAllowed(true);
    pwa.updateServiceWorker.mockResolvedValue(undefined);
    pwa.onRegisteredSW = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setPwaRegistrationAllowed(false);
  });

  test('enregistre le worker seulement apres authentification', () => {
    const { rerender } = render(
      <I18nProvider>
        <AuthContext.Provider value={authValue(false)}><AuthenticatedPwaUpdatePrompt /></AuthContext.Provider>
      </I18nProvider>,
    );
    expect(pwa.useRegisterSW).not.toHaveBeenCalled();

    rerender(
      <I18nProvider>
        <AuthContext.Provider value={authValue(true)}><AuthenticatedPwaUpdatePrompt /></AuthContext.Provider>
      </I18nProvider>,
    );
    expect(screen.getByText(/nouvelle version est disponible/i)).toBeInTheDocument();
    expect(pwa.useRegisterSW).toHaveBeenCalledTimes(1);
  });

  test('rejette une registration terminee apres la deconnexion et repurge ses caches', async () => {
    const { rerender } = render(
      <I18nProvider>
        <AuthContext.Provider value={authValue(true)}><AuthenticatedPwaUpdatePrompt /></AuthContext.Provider>
      </I18nProvider>,
    );
    const lateCallback = pwa.onRegisteredSW;
    const unregister = vi.fn(async () => true);
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal('caches', { keys: vi.fn(async () => ['workbox-late']), delete: deleteCache });

    setPwaRegistrationAllowed(false);
    rerender(
      <I18nProvider>
        <AuthContext.Provider value={authValue(false)}><AuthenticatedPwaUpdatePrompt /></AuthContext.Provider>
      </I18nProvider>,
    );
    lateCallback?.('/sw.js', { unregister } as unknown as ServiceWorkerRegistration);

    await waitFor(() => expect(unregister).toHaveBeenCalledTimes(1));
    expect(deleteCache).toHaveBeenCalledWith('workbox-late');
    expect(pwa.useRegisterSW).toHaveBeenCalledTimes(1);
  });

  test('une callback de A ne supprime pas le worker deja desire par B', async () => {
    const { rerender } = render(
      <I18nProvider>
        <AuthContext.Provider value={authValue(true, 'user-A')}><AuthenticatedPwaUpdatePrompt /></AuthContext.Provider>
      </I18nProvider>,
    );
    const callbackA = pwa.onRegisteredSW;
    const unregister = vi.fn(async () => true);

    setPwaRegistrationAllowed(false);
    rerender(
      <I18nProvider>
        <AuthContext.Provider value={authValue(false)}><AuthenticatedPwaUpdatePrompt /></AuthContext.Provider>
      </I18nProvider>,
    );
    setPwaRegistrationAllowed(true);
    rerender(
      <I18nProvider>
        <AuthContext.Provider value={authValue(true, 'user-B')}><AuthenticatedPwaUpdatePrompt /></AuthContext.Provider>
      </I18nProvider>,
    );
    callbackA?.('/sw.js', { unregister } as unknown as ServiceWorkerRegistration);
    await act(async () => { await Promise.resolve(); });

    expect(unregister).not.toHaveBeenCalled();
    expect(pwa.useRegisterSW).toHaveBeenCalledTimes(2);
  });

  test('un echec de nettoyage tardif bloque puis impose un retry avant reautorisation', async () => {
    const unregister = vi.fn()
      .mockRejectedValueOnce(new Error('echec navigateur'))
      .mockResolvedValue(true);
    const deleteCache = vi.fn(async () => true);
    vi.stubGlobal('caches', { keys: vi.fn(async () => ['workbox-late']), delete: deleteCache });
    const registration = { unregister } as unknown as ServiceWorkerRegistration;

    setPwaRegistrationAllowed(false);
    expect(await discardPwaRegistrationIfDisallowed(registration)).toBe(false);
    expect(isPwaRegistrationAllowed()).toBe(false);

    expect(await authorizePwaRegistrationAfterCleanup(() => true)).toBe(true);
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(deleteCache).toHaveBeenCalledWith('workbox-late');
    expect(isPwaRegistrationAllowed()).toBe(true);
  });

  test('la nouvelle version attend une activation explicite', async () => {
    renderPrompt();
    expect(screen.getByText(/nouvelle version est disponible/i)).toBeInTheDocument();
    expect(pwa.updateServiceWorker).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /mettre à jour maintenant/i }));

    await waitFor(() => expect(pwa.updateServiceWorker).toHaveBeenCalledWith(true));
  });

  test('plus tard masque temporairement la proposition sans perdre le worker en attente', () => {
    vi.useFakeTimers();
    renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: /plus tard/i }));
    expect(screen.queryByText(/nouvelle version est disponible/i)).not.toBeInTheDocument();
    expect(pwa.updateServiceWorker).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(PWA_REMIND_LATER_MS));
    expect(screen.getByText(/nouvelle version est disponible/i)).toBeInTheDocument();
  });

  test('verifie une nouvelle version au retour au premier plan', async () => {
    renderPrompt();
    const update = vi.fn(async () => undefined);
    act(() => pwa.onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  test('affiche une erreur generique si activation echoue', async () => {
    pwa.updateServiceWorker.mockRejectedValueOnce(new Error('detail interne a ne pas afficher'));
    renderPrompt();
    await userEvent.click(screen.getByRole('button', { name: /mettre à jour maintenant/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/n’a pas pu être appliquée/i);
    expect(screen.queryByText(/detail interne/i)).not.toBeInTheDocument();
  });
});
