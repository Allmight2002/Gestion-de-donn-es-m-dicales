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

// Audit UI mobile, lot 2 (T3-B) : la forme du controle dit deja « une seule » ou « plusieurs »
// reponses ; la consigne ne reste que pour les lecteurs d'ecran. Le bouton d'effacement garde
// la question dans son nom accessible, sans la recopier a l'ecran.
test('consignes réservées aux lecteurs d’écran et effacement court à l’écran', async () => {
  const options = [{ valueKey: 'm', label: 'Masculin', isActive: true }, { valueKey: 'f', label: 'Féminin', isActive: true }];
  function Example() {
    const [value, setValue] = useState<string | null>('m');
    return <>
      <ChoiceInput label="Sexe" options={options} value={value} presentation="radios" onChange={(next) => setValue(next as string | null)} />
      <ChoiceInput label="Signes" options={options} value={[]} presentation="grid" onChange={() => {}} />
    </>;
  }
  render(<I18nProvider><Example /></I18nProvider>);
  expect(screen.getByText('Une seule réponse')).toHaveClass('sr-only');
  expect(screen.getByText('Plusieurs réponses possibles')).toHaveClass('sr-only');
  const clear = screen.getByRole('button', { name: 'Effacer la réponse à Sexe' });
  expect(clear).toHaveTextContent(/^Effacer la réponse$/);
  await userEvent.click(clear);
  expect(screen.getByRole('radio', { name: 'Masculin' })).not.toBeChecked();
});
