import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConfirmDialog } from './ConfirmDialog';

function Example({ action }: { action: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Ouvrir</button><a href="#outside">Arrière-plan</a>
    <ConfirmDialog open={open} title="Supprimer ?" body="Confirmer cette suppression." confirmLabel="Supprimer"
      onCancel={() => setOpen(false)} onConfirm={() => { action(); setOpen(false); }} /></>;
}
describe('ConfirmDialog keyboard and focus', () => {
  test('has a labelled dialog, traps Tab, closes on Escape and restores the opener', async () => {
    const action = vi.fn(); const { container } = render(<I18nProvider><Example action={action} /></I18nProvider>);
    const opener = screen.getByRole('button', { name: 'Ouvrir' }); await userEvent.click(opener);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Confirmer cette suppression.');
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus();
    expect(container).toHaveAttribute('aria-hidden', 'true');
    await userEvent.tab({ shift: true }); expect(screen.getByRole('button', { name: 'Supprimer' })).toHaveFocus();
    await userEvent.tab(); expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(opener).toHaveFocus();
    expect(container).not.toHaveAttribute('aria-hidden'); expect(action).not.toHaveBeenCalled();
  });
});
