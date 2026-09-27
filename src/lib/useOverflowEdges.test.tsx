// Audit UI mobile, lot 1 (T1-B) : une rangee d'onglets qui deborde s'estompe du cote ou il
// reste des onglets, et seulement de ce cote-la.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { overflowFadeClass, useOverflowEdges } from './useOverflowEdges';

function Row() {
  const [ref, edges] = useOverflowEdges<HTMLDivElement>();
  return <div data-testid="row" ref={ref} className={overflowFadeClass(edges)}>onglets</div>;
}

// jsdom ne calcule aucune mise en page : on donne a la rangee les mesures d'un telephone.
function scrollTo(row: HTMLElement, scrollLeft: number, scrollWidth = 600) {
  Object.defineProperty(row, 'clientWidth', { configurable: true, value: 360 });
  Object.defineProperty(row, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(row, 'scrollLeft', { configurable: true, value: scrollLeft });
  fireEvent.scroll(row);
}

describe('useOverflowEdges', () => {
  test('estompe le bord où il reste du contenu, puis les deux, puis le début', () => {
    render(<Row />);
    const row = screen.getByTestId('row');
    expect(row.className).toBe('');

    scrollTo(row, 0);
    expect(row).toHaveClass('scroll-fade-end');
    scrollTo(row, 120);
    expect(row).toHaveClass('scroll-fade-both');
    scrollTo(row, 240);
    expect(row).toHaveClass('scroll-fade-start');
  });

  test('une marge intérieure cachée n’est pas prise pour un onglet hors écran', () => {
    render(<Row />);
    const row = screen.getByTestId('row');
    row.style.paddingLeft = '16px';
    row.style.paddingRight = '16px';
    // L'onglet actif amene en vue : seule la marge de droite reste hors ecran.
    scrollTo(row, 124, 500);
    expect(row).toHaveClass('scroll-fade-start');
    expect(row).not.toHaveClass('scroll-fade-both');
    // Au debut, seule la marge de gauche serait cachee : rien a estomper a gauche.
    scrollTo(row, 10, 500);
    expect(row).toHaveClass('scroll-fade-end');
  });

  test('une rangée qui tient à l’écran ne s’estompe pas', () => {
    render(<Row />);
    const row = screen.getByTestId('row');
    scrollTo(row, 0, 360);
    expect(row.className).toBe('');
  });
});
