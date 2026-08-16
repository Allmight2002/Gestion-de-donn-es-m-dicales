import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { I18nProvider } from './I18nProvider';
import { useI18n } from './useI18n';

function ActiveTitle() {
  const { t } = useI18n();
  return <h1>{t('app.title')}</h1>;
}

describe('I18nProvider', () => {
  afterEach(() => localStorage.clear());

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
});
