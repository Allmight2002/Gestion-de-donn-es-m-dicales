// @vitest-environment jsdom
// UI-1 : le selecteur de theme pose/retire la classe `dark` sur <html> et persiste le choix.
import { afterEach, describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../i18n/I18nProvider';
import { ThemeToggle } from './ThemeToggle';

function renderToggle() {
  return render(
    <I18nProvider>
      <ThemeToggle />
    </I18nProvider>,
  );
}

describe('ThemeToggle', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  test('« Sombre » pose la classe dark + persiste ; « Clair » la retire', async () => {
    renderToggle();
    await userEvent.click(screen.getByRole('button', { name: 'Sombre' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('meddata:theme')).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'Clair' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('meddata:theme')).toBe('light');
  });

  test('« Système » suit la preference OS (claire en jsdom par defaut)', async () => {
    renderToggle();
    await userEvent.click(screen.getByRole('button', { name: 'Sombre' }));
    await userEvent.click(screen.getByRole('button', { name: 'Système' }));
    // jsdom : matchMedia absent ou prefere clair -> pas de classe dark.
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('meddata:theme')).toBe('system');
  });
});
