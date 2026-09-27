// Audit UI mobile, lot 1 (T6) : une seule barre d'enregistrement, sur une ligne, qui ne
// masque jamais le champ actif et ne montre « Annuler » et le raccourci que la ou ils servent.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { FormActionBar } from './FormActionBar';

describe('FormActionBar', () => {
  test('action principale, Annuler à partir de lg, reprise ensuite, raccourci au pointeur fin', async () => {
    const onCancel = vi.fn();
    render(
      <I18nProvider>
        <FormActionBar onCancel={onCancel} extra={<button type="button">Recharger les données</button>}>
          <button type="submit">Enregistrer</button>
        </FormActionBar>
      </I18nProvider>,
    );

    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Enregistrer', 'Annuler', 'Recharger les données']);
    // Sous lg, ✕ dans la barre haute remplace « Annuler ».
    const cancel = screen.getByRole('button', { name: 'Annuler' });
    expect(cancel).toHaveClass('max-lg:hidden');
    await userEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Ctrl + Entrée pour enregistrer')).toHaveClass('keyboard-hint', 'max-sm:hidden');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('annonce ce qui empêche d’enregistrer', () => {
    render(
      <I18nProvider>
        <FormActionBar notice="Terminez la section ouverte avant d’enregistrer.">
          <button type="submit" disabled>Enregistrer</button>
        </FormActionBar>
      </I18nProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Terminez la section ouverte avant d’enregistrer.');
    expect(screen.queryByRole('button', { name: 'Annuler' })).not.toBeInTheDocument();
  });

  test('le défilement vers un champ s’arrête au-dessus de la barre, le temps du formulaire', () => {
    document.documentElement.style.scrollPaddingBottom = '';
    const { unmount } = render(
      <I18nProvider>
        <FormActionBar><button type="submit">Enregistrer</button></FormActionBar>
      </I18nProvider>,
    );
    expect(document.documentElement.style.scrollPaddingBottom).toBe('5rem');
    unmount();
    expect(document.documentElement.style.scrollPaddingBottom).toBe('');
  });
});
