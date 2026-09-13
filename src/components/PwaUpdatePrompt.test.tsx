// La proposition de mise a jour ne decide plus si la coquille existe : l'enregistrement se fait
// au demarrage, hors de React et hors de toute session (cf. `src/pwa/appShell.ts`). Le composant
// n'est plus qu'un lecteur de cet etat, et ces tests portent sur ce qu'il en fait.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { PWA_REMIND_LATER_MS, PwaUpdatePrompt } from './PwaUpdatePrompt';
import { registerAppShell, resetAppShellForTests, type AppShellRegistrar } from '../pwa/appShell';

// La fonction d'enregistrement est injectee depuis le point d'entree : le test fournit la
// sienne, sans avoir a simuler le module virtuel de vite-plugin-pwa.
type RegisterOptions = Parameters<AppShellRegistrar>[0];
const pwa = {
  registerSW: vi.fn(),
  updateSW: vi.fn(async () => undefined),
  options: undefined as undefined | RegisterOptions,
};
const fakeRegistrar: AppShellRegistrar = (options) => {
  pwa.options = options;
  pwa.registerSW(options);
  return pwa.updateSW;
};

const renderPrompt = () => render(<I18nProvider><PwaUpdatePrompt /></I18nProvider>);

/** Arme la coquille comme le ferait le demarrage de l'application, puis annonce une version. */
function bootAppShell({ needRefresh = true }: { needRefresh?: boolean } = {}) {
  registerAppShell(fakeRegistrar);
  if (needRefresh) act(() => pwa.options?.onNeedRefresh?.());
}

describe('PwaUpdatePrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppShellForTests();
    pwa.options = undefined;
    pwa.updateSW.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: vi.fn(async () => undefined), ready: new Promise(() => undefined) },
      configurable: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetAppShellForTests();
  });

  test('la coquille s enregistre sans session et le composant n y participe pas', () => {
    // Le rendu seul n'enregistre rien : c'est le demarrage de l'application qui le fait,
    // avant meme de savoir s'il y a un utilisateur.
    renderPrompt();
    expect(pwa.registerSW).not.toHaveBeenCalled();
    expect(screen.queryByText(/nouvelle version est disponible/i)).not.toBeInTheDocument();

    registerAppShell(fakeRegistrar);
    expect(pwa.registerSW).toHaveBeenCalledTimes(1);

    act(() => pwa.options?.onNeedRefresh?.());
    expect(screen.getByText(/nouvelle version est disponible/i)).toBeInTheDocument();
  });

  test('un second demarrage ne cree pas une seconde registration', () => {
    registerAppShell(fakeRegistrar);
    registerAppShell(fakeRegistrar);
    expect(pwa.registerSW).toHaveBeenCalledTimes(1);
  });

  test('la nouvelle version attend une activation explicite', async () => {
    bootAppShell();
    renderPrompt();
    expect(screen.getByText(/nouvelle version est disponible/i)).toBeInTheDocument();
    expect(pwa.updateSW).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /mettre à jour maintenant/i }));

    await waitFor(() => expect(pwa.updateSW).toHaveBeenCalledWith(true));
  });

  test('plus tard masque temporairement la proposition sans perdre le worker en attente', () => {
    vi.useFakeTimers();
    bootAppShell();
    renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: /plus tard/i }));
    expect(screen.queryByText(/nouvelle version est disponible/i)).not.toBeInTheDocument();
    expect(pwa.updateSW).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(PWA_REMIND_LATER_MS));
    expect(screen.getByText(/nouvelle version est disponible/i)).toBeInTheDocument();
  });

  test('verifie une nouvelle version au retour au premier plan', async () => {
    const update = vi.fn(async () => undefined);
    registerAppShell(fakeRegistrar);
    act(() => pwa.options?.onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration));
    act(() => pwa.options?.onNeedRefresh?.());
    renderPrompt();

    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  test('affiche une erreur generique si activation echoue', async () => {
    pwa.updateSW.mockRejectedValueOnce(new Error('detail interne a ne pas afficher'));
    bootAppShell();
    renderPrompt();
    await userEvent.click(screen.getByRole('button', { name: /mettre à jour maintenant/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/n’a pas pu être appliquée/i);
    expect(screen.queryByText(/detail interne/i)).not.toBeInTheDocument();
  });
});
