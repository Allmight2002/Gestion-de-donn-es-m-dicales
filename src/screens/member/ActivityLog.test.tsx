// @vitest-environment jsdom
// C3 : le journal d'activite rend des libelles LISIBLES + un repli pour une action inconnue.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ActivityLog } from './ActivityLog';
import type { AuditRepository } from '../../data/audit';

const makeAudit = (getBaseActivity: AuditRepository['getBaseActivity']): AuditRepository => ({
  logIdentityRead: async () => undefined,
  logRawDocumentRead: async () => undefined,
  logAttachmentRead: async () => undefined,
  logExportRead: async () => undefined,
  getBaseActivity,
});

function renderActivity(audit: AuditRepository) {
  render(
    <I18nProvider>
      <RepositoryProvider audit={audit}>
        <MemoryRouter initialEntries={['/bases/b1/activity']}>
          <Routes><Route path="/bases/:id/activity" element={<ActivityLog />} /></Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('ActivityLog (C3)', () => {
  test('affiche les libelles lisibles, le detail d import, et un repli pour action inconnue', async () => {
    const audit = makeAudit(async () => [
      { id: 'a1', at: '2026-07-03T10:00:00.000Z', action: 'data_imported', actorName: 'Dr Mbassi', metadata: { patients_new: 5, patients_updated: 2, encounters: 12, errors: 1 } },
      { id: 'a2', at: '2026-07-03T09:00:00.000Z', action: 'access_granted', actorName: 'Dr Mbassi', metadata: {} },
      { id: 'a3', at: '2026-07-03T08:00:00.000Z', action: 'weird_unknown_action', actorName: 'Dr Ngo', metadata: null },
    ]);

    renderActivity(audit);

    const list = await screen.findByRole('list');
    expect(within(list).getByText('Import de données')).toBeInTheDocument();
    expect(within(list).getByText('Accès accordé')).toBeInTheDocument();
    expect(within(list).getByText('weird_unknown_action')).toBeInTheDocument(); // repli sur l'action brute
    expect(within(list).getByText(/7 patients · 12 rencontres · 1 erreurs/)).toBeInTheDocument(); // detail (5+2)
  });

  test('filtre le journal par action', async () => {
    const getBaseActivity = vi.fn<AuditRepository['getBaseActivity']>(async (_baseId, options) => {
      if (options?.action === 'access_revoked') {
        return [{ id: 'a2', at: '2026-07-03T11:00:00.000Z', action: 'access_revoked', actorName: 'Dr Mbassi', metadata: {} }];
      }
      return [{ id: 'a1', at: '2026-07-03T10:00:00.000Z', action: 'access_granted', actorName: 'Dr Mbassi', metadata: {} }];
    });
    renderActivity(makeAudit(getBaseActivity));

    expect(within(await screen.findByRole('list')).getByText('Accès accordé')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'access_revoked');

    expect(within(await screen.findByRole('list')).getByText('Accès révoqué')).toBeInTheDocument();
    expect(getBaseActivity).toHaveBeenLastCalledWith('b1', { limit: 50, action: 'access_revoked' });
  });

  test('charge la page suivante avec un curseur temporel', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => ({
      id: `a${String(i).padStart(2, '0')}`,
      at: new Date(Date.UTC(2026, 6, 3, 10, 0 - i, 0)).toISOString(),
      action: 'access_granted',
      actorName: 'Dr Mbassi',
      metadata: {},
    }));
    const getBaseActivity = vi.fn<AuditRepository['getBaseActivity']>(async (_baseId, options) => {
      if (options?.before) {
        return [{ id: 'next', at: '2026-07-03T08:00:00.000Z', action: 'export_created', actorName: 'Dr Mbassi', metadata: {} }];
      }
      return firstPage;
    });
    renderActivity(makeAudit(getBaseActivity));

    const loadMore = await screen.findByRole('button', { name: 'Charger plus' });
    await userEvent.click(loadMore);

    expect(within(await screen.findByRole('list')).getByText('Export généré')).toBeInTheDocument();
    expect(getBaseActivity).toHaveBeenLastCalledWith('b1', {
      before: firstPage[49].at,
      beforeId: firstPage[49].id,
      limit: 50,
      action: null,
    });
  });
});
