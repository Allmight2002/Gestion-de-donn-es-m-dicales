// @vitest-environment jsdom
// E3 : le centre de synchronisation affiche un panneau « état du système » (connexion, version,
// bases hors-ligne, anomalies) en plus de la file d'attente de synchronisation.
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { SyncCenter } from './SyncCenter';
import type { PatientRepository } from '../../data/patients';

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
});
