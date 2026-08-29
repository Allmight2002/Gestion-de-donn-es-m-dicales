// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Checkbox } from './Checkbox';

function ControlledCheckbox({ disabled = false }: { disabled?: boolean }) {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      label="Voir les identites"
      checked={checked}
      disabled={disabled}
      onChange={(event) => setChecked(event.target.checked)}
    />
  );
}

describe('Checkbox', () => {
  test('associe le libelle, offre une cible tactile et bascule au clic', async () => {
    const user = userEvent.setup();
    render(<ControlledCheckbox />);

    const checkbox = screen.getByRole('checkbox', { name: 'Voir les identites' });
    const target = checkbox.closest('label');
    expect(target).toHaveClass('min-h-11');
    expect(checkbox).not.toBeChecked();

    await user.click(screen.getByText('Voir les identites'));
    expect(checkbox).toBeChecked();
  });

  test('reste une case native utilisable au clavier avec un focus visible', async () => {
    const user = userEvent.setup();
    render(<ControlledCheckbox />);

    const checkbox = screen.getByRole('checkbox', { name: 'Voir les identites' });
    await user.tab();
    expect(checkbox).toHaveFocus();
    await user.keyboard('[Space]');
    expect(checkbox).toBeChecked();
  });

  test('preserve les etats desactive et indetermine', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ControlledCheckbox disabled />);
    const checkbox = screen.getByRole('checkbox', { name: 'Voir les identites' });

    expect(checkbox).toBeDisabled();
    await user.click(screen.getByText('Voir les identites'));
    expect(checkbox).not.toBeChecked();

    rerender(<Checkbox aria-label="Selection partielle" indeterminate />);
    expect((screen.getByRole('checkbox', { name: 'Selection partielle' }) as HTMLInputElement).indeterminate).toBe(true);
  });

  test('neutralise sa transition si les mouvements sont reduits', () => {
    render(<Checkbox label="Exporter" />);
    expect(screen.getByRole('checkbox', { name: 'Exporter' }).closest('label')).toHaveClass('motion-reduce:transition-none');
  });
});
