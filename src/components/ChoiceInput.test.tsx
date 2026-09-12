import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { ChoiceInput } from './ChoiceInput';

test('search filters options without moving or dropping selections, including historical options', async () => {
  const options = [{ valueKey: 'old', label: 'Historique', isActive: false }, ...Array.from({ length: 9 }, (_, index) => ({ valueKey: `k${index}`, label: `Option ${index}`, isActive: true }))];
  function Example() { const [values, setValues] = useState<string[]>(['old']); return <ChoiceInput label="Choix" options={options} value={values}
    presentation="search-multiple" onChange={(next) => setValues(next as string[])} />; }
  render(<I18nProvider><Example /></I18nProvider>);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Option 2' }));
  await userEvent.type(screen.getByRole('searchbox'), 'Option 7');
  expect(screen.queryByRole('checkbox', { name: 'Option 2' })).not.toBeInTheDocument();
  const summary = screen.getByRole('list', { name: 'Sélections de Choix' });
  expect(within(summary).getByText('Option 2')).toBeInTheDocument();
  expect(within(summary).getByText('Historique')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
  expect(screen.getByRole('checkbox', { name: 'Option 2' })).toBeChecked();
  await userEvent.click(within(summary).getByRole('button', { name: 'Retirer Historique' }));
  expect(screen.getByRole('checkbox', { name: 'Historique' })).not.toBeChecked();
  expect(screen.getAllByRole('checkbox').map((control) => control.getAttribute('aria-label'))).toEqual(options.map((option) => option.label));
});
