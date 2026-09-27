// Audit UI mobile, lot 1 (T3-B) : l'aide a la demande garde le contrat des fenetres
// (focus, Echap, focus rendu) et ne montre rien tant qu'on ne la demande pas.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { HelpTip } from './HelpTip';

function renderTip() {
  return render(
    <I18nProvider>
      <p>Journal d’activité</p>
      <HelpTip label="À propos de cette page">Consultez les actions récentes sur cette base.</HelpTip>
    </I18nProvider>,
  );
}

describe('HelpTip', () => {
  test('reste fermée : un bouton nommé, sans texte d’aide affiché', () => {
    renderTip();
    const trigger = screen.getByRole('button', { name: 'À propos de cette page' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByText(/actions récentes/)).not.toBeInTheDocument();
  });

  test('s’ouvre en fenêtre nommée, garde le focus, se ferme sur Échap et rend le focus', async () => {
    const { container } = renderTip();
    const trigger = screen.getByRole('button', { name: 'À propos de cette page' });
    await userEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'À propos de cette page' });
    expect(within(dialog).getByText('Consultez les actions récentes sur cette base.')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const close = within(dialog).getByRole('button', { name: 'Fermer' });
    expect(close).toHaveFocus();
    expect(container).toHaveAttribute('aria-hidden', 'true');
    await userEvent.tab();
    expect(close).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(container).not.toHaveAttribute('aria-hidden');
  });

  test('se ferme par le bouton Fermer comme par un appui hors du panneau', async () => {
    renderTip();
    const trigger = screen.getByRole('button', { name: 'À propos de cette page' });
    await userEvent.click(trigger);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    const backdrop = screen.getByRole('dialog').firstElementChild as HTMLElement;
    await userEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
