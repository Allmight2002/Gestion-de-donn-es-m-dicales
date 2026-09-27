// Audit UI mobile, lot 2 (5.6-B) : un simple etat du brouillon tient sur une ligne, et la
// pastille ne passe au vert qu'apres un accuse de reception (spec UX §4.2).
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

function renderPanel(draft: Draft, identityInForm = false) {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <WorkDraftPanel draft={draft} online baseId="b1" identityInForm={identityInForm} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('WorkDraftPanel — état sur une ligne', () => {
  test('non sauvegardé : une ligne sans cadre, pastille orange, précision derrière ⓘ', () => {
    const { container } = renderPanel(draftWith({}));
    expect(screen.getByRole('status')).toHaveTextContent('Modifications non sauvegardées');
    expect(container.firstElementChild).not.toHaveClass('border');
    expect(container.querySelector('[aria-hidden="true"].rounded-full')).toHaveClass('bg-amber-500');
    expect(screen.getByRole('button', { name: 'À propos du brouillon' })).toBeInTheDocument();
    expect(screen.queryByText(/L’identité saisie n’est pas incluse/)).not.toBeInTheDocument();
  });

  test('pastille verte seulement avec un accusé ; en cours de sauvegarde, elle reste neutre', () => {
    const { container, unmount } = renderPanel(draftWith({
      protected: true, state: { status: 'idle', receipt: { updatedAt: '2026-09-27T12:32:00.000Z' } } as Draft['state'],
    }));
    expect(screen.getByRole('status')).toHaveTextContent('Brouillon sauvegardé à');
    expect(container.querySelector('[aria-hidden="true"].rounded-full')).toHaveClass('bg-teal-600');
    unmount();

    const saving = renderPanel(draftWith({ protected: true, state: { status: 'saving' } as Draft['state'] }));
    expect(screen.getByRole('status')).toHaveTextContent('Sauvegarde du brouillon…');
    expect(saving.container.querySelector('[aria-hidden="true"].rounded-full')).toHaveClass('bg-slate-400');
  });

  test('quand le formulaire fait saisir une identité, la précision reste lisible', () => {
    renderPanel(draftWith({}), true);
    expect(screen.getByText('Données cliniques uniquement. L’identité saisie n’est pas incluse dans ce brouillon.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'À propos du brouillon' })).not.toBeInTheDocument();
  });
});
