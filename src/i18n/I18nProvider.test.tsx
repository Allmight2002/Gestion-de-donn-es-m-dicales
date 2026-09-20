import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { I18nProvider } from './I18nProvider';
import { useI18n } from './useI18n';

function ActiveTitle() {
  const { t } = useI18n();
  return <h1>{t('app.title')}</h1>;
}

describe('I18nProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  test('charge la seconde langue sans retirer le contenu courant', async () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <ActiveTitle />
      </I18nProvider>,
    );

    expect(screen.getByRole('heading')).toHaveTextContent('Registre clinique');

    fireEvent.change(screen.getByRole('combobox', { name: 'language' }), { target: { value: 'en' } });

    expect(screen.getByRole('heading')).toHaveTextContent('Registre clinique');
    expect(screen.getByRole('combobox', { name: 'language' })).toHaveAttribute('aria-busy', 'true');

    await waitFor(() => {
      expect(screen.getByRole('heading')).toHaveTextContent('Clinical registry');
      expect(document.documentElement.lang).toBe('en');
      expect(localStorage.getItem('registre.lang')).toBe('en');
    });
  });

  // Un stockage refuse (navigation privee, quota, politique d'entreprise) fait lever
  // setItem/getItem. La preference de langue peut etre perdue, mais l'APPLICATION
  // doit demarrer : l'ecriture part d'un effet et la lecture de l'initialiseur d'etat,
  // deux chemins ou une exception ferait echouer tout le montage, pas juste l'i18n.
  test('se rend malgre un stockage local qui refuse l ecriture', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    render(
      <I18nProvider>
        <ActiveTitle />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading')).toHaveTextContent('Registre clinique');
  });

  test('se rend malgre un stockage local qui refuse la lecture', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('acces refuse');
    });

    render(
      <I18nProvider>
        <ActiveTitle />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading')).toHaveTextContent('Registre clinique');
  });
});
