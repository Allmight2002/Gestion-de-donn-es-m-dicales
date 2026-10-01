// @vitest-environment jsdom
// Codage CIM-11 assiste : la liste des diagnostics restes non codes ou a confirmer rouvre la
// fiche ou la rencontre concernee. Donnees fictives.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { PendingCodings } from './PendingCodings';
import type { BaseRepository, PendingCoding, PendingCodingPage } from '../../data/bases';

const item = (over: Partial<PendingCoding>): PendingCoding => ({
  patientId: 'p1', patientCode: 'P-0001', encounterId: null, encounterType: null, encounterDate: null,
  fieldKey: 'diag', fieldLabel: 'Diagnostic principal', position: null, raw: 'Syndrome fictif rare',
  proposedLabel: null, status: 'unmatched', updatedAt: '2026-09-28T08:00:00Z', ...over,
});
const ITEMS: PendingCoding[] = [
  item({
    patientId: 'p2', patientCode: 'P-0002', encounterId: 'e7', encounterType: 'consultation', encounterDate: '2026-09-12',
    fieldKey: 'diag_liste', fieldLabel: 'Diagnostics associés', position: 1, raw: 'Douleur fictive atypique',
  }),
  item({ status: 'suggested', raw: 'HSD chronique fictif', proposedLabel: 'Hémorragie sousdurale non traumatique' }),
];

function renderPage(bases: Partial<BaseRepository>) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases as BaseRepository}>
        <MemoryRouter initialEntries={['/bases/b1/codings']}>
          <Routes>
            <Route path="/bases/:id/codings" element={<PendingCodings />} />
            <Route path="/bases/:id/patients/:patientId/edit" element={<div>EDIT PATIENT</div>} />
            <Route path="/bases/:id/patients/:patientId/encounters/:encounterId/edit" element={<div>EDIT ENCOUNTER</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('diagnostics à coder', () => {
  test('chaque entrée dit où elle est, ce qui a été écrit et ce qui reste à faire', async () => {
    const listPendingCodings = vi.fn(async (): Promise<PendingCodingPage> => ({ items: ITEMS, hasMore: false }));
    renderPage({ listPendingCodings });

    expect(await screen.findByRole('heading', { name: 'Diagnostics à coder' })).toBeInTheDocument();
    expect(listPendingCodings).toHaveBeenCalledWith('b1', 100);
    expect(screen.getByText('P-0002')).toBeInTheDocument();
    expect(screen.getByText(/Diagnostics associés · n° 2/)).toBeInTheDocument();
    expect(screen.getByText('Douleur fictive atypique')).toBeInTheDocument();
    expect(screen.getByText('non codé')).toBeInTheDocument();
    expect(screen.getByText('Données permanentes')).toBeInTheDocument();
    expect(screen.getByText('à confirmer')).toBeInTheDocument();
    expect(screen.getByText('Proposé : Hémorragie sousdurale non traumatique')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: 'Ouvrir la fiche' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/bases/b1/patients/p2/encounters/e7/edit', '/bases/b1/patients/p1/edit',
    ]);
    await userEvent.click(links[0]);
    expect(await screen.findByText('EDIT ENCOUNTER')).toBeInTheDocument();
  });

  test('liste tronquée : la page le dit', async () => {
    renderPage({ listPendingCodings: async () => ({ items: ITEMS, hasMore: true }) });
    expect(await screen.findByText('Seuls les 100 plus récents sont affichés.')).toBeInTheDocument();
  });

  test('rien en attente : état vide', async () => {
    renderPage({ listPendingCodings: async () => ({ items: [], hasMore: false }) });
    expect(await screen.findByText('Aucun diagnostic en attente de codage.')).toBeInTheDocument();
  });

  test('échec ou serveur sans la lecture : une phrase, sans détail technique', async () => {
    const { unmount } = renderPage({ listPendingCodings: async () => { throw new Error('PGRST202 permission denied fictif'); } });
    expect(await screen.findByRole('alert')).toHaveTextContent('La liste des diagnostics à coder est indisponible pour le moment.');
    expect(screen.queryByText(/PGRST|permission/)).toBeNull();
    unmount();

    renderPage({});
    expect(await screen.findByRole('alert')).toHaveTextContent('indisponible');
  });
});
