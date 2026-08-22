// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../i18n/I18nProvider';
import { DatePickerInput } from './DatePickerInput';

function renderPicker(value: string | null, onChange = vi.fn()) {
  render(
    <I18nProvider>
      <DatePickerInput value={value} ariaLabel="Date de consultation" onChange={onChange} />
    </I18nProvider>,
  );
  return onChange;
}

describe('DatePickerInput', () => {
  test('affiche clairement le mois et l annee puis renvoie une date ISO', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker('2024-06-15');

    await user.click(screen.getByRole('button', { name: 'Date de consultation' }));
    expect(screen.getByRole('dialog', { name: 'Sélecteur de date' })).toHaveTextContent('juin 2024');

    await user.click(screen.getByRole('button', { name: '20 juin 2024' }));
    expect(onChange).toHaveBeenCalledWith('2024-06-20');
  });

  test('permet d effacer une date sans produire une chaine vide', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker('2024-06-15');

    await user.click(screen.getByRole('button', { name: 'Date de consultation' }));
    await user.click(screen.getByRole('button', { name: 'Effacer la date' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
