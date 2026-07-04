// @vitest-environment jsdom
// C3 : le journal d'activite rend des libelles LISIBLES + un repli pour une action inconnue.
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ActivityLog } from './ActivityLog';
import type { AuditRepository } from '../../data/audit';

const audit = {
  async getBaseActivity() {
    return [
      { at: '2026-07-03T10:00:00.000Z', action: 'data_imported', actorName: 'Dr Mbassi', metadata: { patients_new: 5, patients_updated: 2, encounters: 12, errors: 1 } },
      { at: '2026-07-03T09:00:00.000Z', action: 'access_granted', actorName: 'Dr Mbassi', metadata: {} },
      { at: '2026-07-03T08:00:00.000Z', action: 'weird_unknown_action', actorName: 'Dr Ngo', metadata: null },
    ];
  },
} as unknown as AuditRepository;

describe('ActivityLog (C3)', () => {
  test('affiche les libelles lisibles, le detail d import, et un repli pour action inconnue', async () => {
    render(
      <I18nProvider>
        <RepositoryProvider audit={audit}>
          <MemoryRouter initialEntries={['/bases/b1/activity']}>
            <Routes><Route path="/bases/:id/activity" element={<ActivityLog />} /></Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );
    expect(await screen.findByText('Import de données')).toBeInTheDocument();
    expect(screen.getByText('Accès accordé')).toBeInTheDocument();
    expect(screen.getByText('weird_unknown_action')).toBeInTheDocument(); // repli sur l'action brute
    expect(screen.getByText(/7 patients · 12 rencontres · 1 erreurs/)).toBeInTheDocument(); // detail (5+2)
  });
});
