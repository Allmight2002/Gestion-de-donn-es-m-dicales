import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

export async function setBirthDate(value: string) {
  const [year, month, day] = value.split('-');
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: /date de naissance/i }));

  const dayInput = screen.getByRole('textbox', { name: 'Jour' });
  const monthInput = screen.getByRole('textbox', { name: 'Mois' });
  const yearInput = screen.getByRole('textbox', { name: 'Année' });
  await user.clear(dayInput);
  await user.type(dayInput, day);
  await user.clear(monthInput);
  await user.type(monthInput, month);
  await user.clear(yearInput);
  await user.type(yearInput, year);
  await user.click(screen.getByRole('button', { name: 'Utiliser cette date' }));
}
