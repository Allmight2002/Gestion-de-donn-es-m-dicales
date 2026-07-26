// @vitest-environment jsdom
// E3 : le centre de synchronisation affiche un panneau « état du système » (connexion, version,
// bases hors-ligne, anomalies) en plus de la file d'attente de synchronisation.
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { SyncCenter } from './SyncCenter';
import type { PatientRepository } from '../../data/patients';
import { outbox, purgeAllOfflineData, setOfflineUser, type OutboxEntry } from '../../data/offline';

beforeAll(() => {
  vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  vi.stubEnv('VITE_OFFLINE_ADMIN_ACK', 'true');
  setOfflineUser('sync-ui-user');
});
afterAll(() => { setOfflineUser(null); vi.unstubAllEnvs(); });

const patients = {} as unknown as PatientRepository;

function renderSync() {
  return render(
    <I18nProvider>
      <RepositoryProvider patients={patients}>
        <MemoryRouter>
          <SyncCenter />
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('SyncCenter — état du système (E3)', () => {
  test('affiche connexion, version (injectée), bases hors-ligne et la section anomalies', async () => {
    renderSync();
    expect(await screen.findByRole('heading', { level: 1, name: 'État du système' })).toBeInTheDocument();
    expect(screen.getByText('Connexion')).toBeInTheDocument();
    expect(screen.getByText('En ligne')).toBeInTheDocument(); // navigator.onLine = true par défaut (jsdom)
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.getByText('Commit')).toBeInTheDocument();
    expect(screen.getByText('test-commit')).toBeInTheDocument();
    expect(screen.getByText('Branche')).toBeInTheDocument();
    expect(screen.getByText('test-branch')).toBeInTheDocument();
    expect(screen.getByText('2026-07-07T00:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText(/test · test/)).toBeInTheDocument(); // __APP_VERSION__='test' · MODE='test'
    // La section anomalies est presente (repliable) ; aucune anomalie au rendu initial.
    expect(screen.getByText(/Anomalies techniques récentes/)).toBeInTheDocument();
  });

  test('affiche pending, syncing, conflict et rejected avec metadonnees et actions', async () => {
    await purgeAllOfflineData();
    setOfflineUser('sync-ui-user');
    const base: Omit<OutboxEntry, 'id' | 'state'> = {
      dataType: 'analytic_outbox', baseId: 'base-ui', patientId: 'patient-ui', encounterId: 'encounter-ui',
      data: { score: 4 }, reason: 'test UI', validationStatus: 'draft', baseUpdatedAt: null,
      createdAt: Date.now(), expiresAt: Date.now() + 60_000, ownerUserId: 'sync-ui-user', attemptCount: 2,
    };
    await outbox.put({ ...base, id: 'ui-pending', state: 'pending', lastError: 'reseau indisponible' });
    await outbox.put({ ...base, id: 'ui-syncing', state: 'syncing', syncingStartedAt: Date.now() });
    await outbox.put({ ...base, id: 'ui-conflict', state: 'conflict', lastError: 'CONFLIT_VERSION' });
    await outbox.put({ ...base, id: 'ui-rejected', state: 'rejected', lastError: 'permission denied' });

    renderSync();
    expect(await screen.findByRole('heading', { name: /En attente \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Synchronisation en cours \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Conflits \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Rejets definitifs \(1\)/ })).toBeInTheDocument();
    expect(screen.getAllByText('encounter-ui')).toHaveLength(4);
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retenter' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Copier les donnees' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Supprimer' }).length).toBeGreaterThan(0);
    await purgeAllOfflineData();
    setOfflineUser(null);
  });
});
