import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

const pwa = vi.hoisted(() => ({
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(async () => undefined),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [true, pwa.setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: pwa.updateServiceWorker,
  }),
}));

const renderPrompt = () => render(<I18nProvider><PwaUpdatePrompt /></I18nProvider>);

describe('PwaUpdatePrompt', () => {
  beforeEach(() => vi.clearAllMocks());

  test('la nouvelle version attend une activation explicite', async () => {
    renderPrompt();
    expect(screen.getByText(/nouvelle version est disponible/i)).toBeInTheDocument();
    expect(pwa.updateServiceWorker).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /mettre à jour maintenant/i }));

    await waitFor(() => expect(pwa.updateServiceWorker).toHaveBeenCalledWith(true));
  });

  test('plus tard masque la proposition sans activer le worker', async () => {
    renderPrompt();
    await userEvent.click(screen.getByRole('button', { name: /plus tard/i }));
    expect(pwa.setNeedRefresh).toHaveBeenCalledWith(false);
    expect(pwa.updateServiceWorker).not.toHaveBeenCalled();
  });
});
