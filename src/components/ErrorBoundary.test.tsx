// @vitest-environment jsdom
// F-7 : le filet anti-plantage montre un repli lisible (jamais d'ecran blanc) et journalise
// l'erreur en INTERNE, sans rien transmettre a l'exterieur.
import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n/I18nProvider';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('boom test');
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  test('affiche un repli localise (pas d ecran blanc) et journalise en interne quand un enfant plante', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <I18nProvider>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </I18nProvider>,
    );
    // Repli visible + action de reprise (au lieu du vide).
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Une erreur inattendue est survenue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /recharger/i })).toBeInTheDocument();
    // Journalisation interne (tag [client-error]) — aucune sortie reseau.
    expect(spy).toHaveBeenCalledWith('[client-error]', expect.stringContaining('boom test'), expect.anything());
  });

  test('rend normalement les enfants quand il n y a pas d erreur', () => {
    render(
      <I18nProvider>
        <ErrorBoundary>
          <p>contenu ok</p>
        </ErrorBoundary>
      </I18nProvider>,
    );
    expect(screen.getByText('contenu ok')).toBeInTheDocument();
  });
});
