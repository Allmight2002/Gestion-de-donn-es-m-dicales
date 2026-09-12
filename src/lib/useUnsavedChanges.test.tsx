import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, RouterProvider } from 'react-router';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { requestPageLeave, useDirtyForm } from './useUnsavedChanges';

function Form() {
  const [value, setValue] = useState('');
  const guard = useDirtyForm({ value }, true, 'test');
  return <>{guard.guard}<label>Réponse<input value={value} onChange={(event) => setValue(event.target.value)} /></label>
    <Link to="/next">Suivant</Link><button onClick={guard.markClean}>Enregistrer</button></>;
}
function setup() {
  const router = createMemoryRouter([{ path: '/', element: <Form /> }, { path: '/next', element: <p>Destination</p> }]);
  render(<I18nProvider><RouterProvider router={router} /></I18nProvider>);
  return router;
}
describe('form departure protection', () => {
  test('cancel preserves answers; confirming internal navigation changes the route', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Réponse'), 'Texte fictif');
    await userEvent.click(screen.getByRole('link', { name: 'Suivant' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Quitter cette saisie ?');
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getByLabelText('Réponse')).toHaveValue('Texte fictif');
    await userEvent.click(screen.getByRole('link', { name: 'Suivant' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitter la saisie' }));
    expect(await screen.findByText('Destination')).toBeInTheDocument();
  });
  test('page reload and voluntary sign-out share the unsaved state; successful save releases it', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Réponse'), { target: { value: 'Valeur' } });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    let decision!: Promise<boolean>;
    act(() => { decision = requestPageLeave(); });
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(await decision).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await requestPageLeave()).toBe(true);
    await userEvent.click(screen.getByRole('link', { name: 'Suivant' }));
    expect(await screen.findByText('Destination')).toBeInTheDocument();
  });
});
