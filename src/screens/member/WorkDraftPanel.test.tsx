// La sauvegarde automatique du brouillon reste silencieuse : le panneau ne s'insere au-dessus
// du formulaire que pour un etat a traiter, afin de ne pas decaler la saisie.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { WorkDraftPanel } from './WorkDraftPanel';
import type { useWorkDraft } from './useWorkDraft';

type Draft = ReturnType<typeof useWorkDraft>;
const draftWith = (over: Partial<Draft>): Draft => ({
  enabled: true, loading: false, locked: false, dirty: true, error: null, discarding: false,
  state: { status: 'idle' }, candidates: [], completed: [], support: 'server', protected: false,
  retry: () => {}, startNew: () => {}, resume: () => {}, discard: async () => {},
  ...over,
} as unknown as Draft);

function renderPanel(draft: Draft, { identityInForm = false, online = true } = {}) {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <WorkDraftPanel draft={draft} online={online} baseId="b1" identityInForm={identityInForm} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('WorkDraftPanel — silencieux hors état à traiter', () => {
  test.each([
    ['recherche', { loading: true, dirty: false }],
    ['saisie en cours', {}],
    ['sauvegarde en cours', { state: { status: 'saving' } as Draft['state'] }],
    ['brouillon sauvegardé', { protected: true, state: { status: 'saved', receipt: { updatedAt: '2026-09-27T12:32:00.000Z' } } as Draft['state'] }],
  ])('%s : rien ne s’insère au-dessus du formulaire', (_label, over) => {
    const { container } = renderPanel(draftWith(over), { identityInForm: true });
    expect(container).toBeEmptyDOMElement();
  });

  test('hors ligne avec une saisie non protégée : l’avertissement reste visible', () => {
    renderPanel(draftWith({}), { online: false });
    expect(screen.getByRole('status')).toHaveTextContent('Connexion interrompue');
  });

  test('hors ligne sans saisie : rien à signaler', () => {
    const { container } = renderPanel(draftWith({ dirty: false }), { online: false });
    expect(container).toBeEmptyDOMElement();
  });

  test('saisie verrouillée : l’état est annoncé', () => {
    renderPanel(draftWith({ locked: true, state: { status: 'saving', locked: true } as Draft['state'] }));
    expect(screen.getByRole('status')).toHaveTextContent('saisie momentanément verrouillée');
  });

  test('échec : l’erreur, la reprise et la précision sur l’identité s’affichent', () => {
    renderPanel(draftWith({ error: 'Brouillon indisponible' }), { identityInForm: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Brouillon indisponible');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(screen.getByText('Données cliniques uniquement. L’identité saisie n’est pas incluse dans ce brouillon.')).toBeInTheDocument();
  });
});
