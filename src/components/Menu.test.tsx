// @vitest-environment jsdom
// D9 — menu flottant a fermeture explicite : ouverture, bascule, fermeture au clic
// exterieur, a Echap (avec retour du focus), a la selection, un seul menu ouvert.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, MenuItem } from './Menu';

function triggerFor(label: string) {
  return screen.getByRole('button', { name: label });
}

describe('Menu (D9)', () => {
  test('ouvre au clic sur le declencheur et bascule au re-clic', async () => {
    render(
      <Menu triggerLabel="Actions" triggerContent="Actions">
        <MenuItem onSelect={() => {}}>Renommer</MenuItem>
      </Menu>,
    );
    const trigger = triggerFor('Actions');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Renommer' })).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(trigger);
    expect(screen.queryByRole('button', { name: 'Renommer' })).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('se ferme au pointerdown hors du menu', async () => {
    render(
      <>
        <Menu triggerLabel="Actions" triggerContent="Actions">
          <MenuItem onSelect={() => {}}>Renommer</MenuItem>
        </Menu>
        <button>Ailleurs</button>
      </>,
    );
    await userEvent.click(triggerFor('Actions'));
    expect(screen.getByRole('button', { name: 'Renommer' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ailleurs' }));
    expect(screen.queryByRole('button', { name: 'Renommer' })).toBeNull();
  });

  test('se ferme a Echap et rend le focus au declencheur', async () => {
    render(
      <Menu triggerLabel="Actions" triggerContent="Actions">
        <MenuItem onSelect={() => {}}>Renommer</MenuItem>
      </Menu>,
    );
    const trigger = triggerFor('Actions');
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Renommer' })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('se ferme a la selection d une entree, apres avoir lance l action', async () => {
    const onSelect = vi.fn();
    render(
      <Menu triggerLabel="Actions" triggerContent="Actions">
        <MenuItem onSelect={onSelect}>Renommer</MenuItem>
      </Menu>,
    );
    await userEvent.click(triggerFor('Actions'));
    await userEvent.click(screen.getByRole('button', { name: 'Renommer' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Renommer' })).toBeNull();
  });

  test('un seul menu ouvert a la fois', async () => {
    render(
      <>
        <Menu triggerLabel="Actions A" triggerContent="A">
          <MenuItem onSelect={() => {}}>Entree A</MenuItem>
        </Menu>
        <Menu triggerLabel="Actions B" triggerContent="B">
          <MenuItem onSelect={() => {}}>Entree B</MenuItem>
        </Menu>
      </>,
    );
    await userEvent.click(triggerFor('Actions A'));
    expect(screen.getByRole('button', { name: 'Entree A' })).toBeInTheDocument();
    await userEvent.click(triggerFor('Actions B'));
    expect(screen.queryByRole('button', { name: 'Entree A' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Entree B' })).toBeInTheDocument();
    expect(triggerFor('Actions A')).toHaveAttribute('aria-expanded', 'false');
    expect(triggerFor('Actions B')).toHaveAttribute('aria-expanded', 'true');
  });
});