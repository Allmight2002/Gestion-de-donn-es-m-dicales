// @vitest-environment jsdom
// B2 : la file « a completer » liste les dossiers non finalises avec leurs manquants et ouvre
// directement le bon formulaire.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { CompletionQueue } from './CompletionQueue';
import type { PatientRepository, CompletionItem } from '../../data/patients';

const items: CompletionItem[] = [
  { kind: 'patient', patientId: 'p1', code: 'P-0001', status: 'draft', missing: ['Année de naissance'] },
  { kind: 'encounter', patientId: 'p1', encounterId: 'e1', code: 'P-0001', encounterType: 'consultation', encounterDate: '2024-05-01', status: 'draft', missing: ['Glasgow'] },
];

function renderQueue(patients: PatientRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider patients={patients}>
        <MemoryRouter initialEntries={['/bases/b1/queue']}>
          <Routes>
            <Route path="/bases/:id/queue" element={<CompletionQueue />} />
            <Route path="/bases/:id/patients/:patientId/edit" element={<div>EDIT PATIENT</div>} />
            <Route path="/bases/:id/patients/:patientId/encounters/:encounterId/edit" element={<div>EDIT ENCOUNTER</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('CompletionQueue (B2)', () => {
  test('liste les dossiers + manquants, et « Compléter » ouvre le bon formulaire', async () => {
    const getCompletionQueuePage = vi.fn(async () => ({ items, total: items.length, limit: 50, offset: 0, hasMore: false }));
    renderQueue({ getCompletionQueuePage } as unknown as PatientRepository);

    expect(await screen.findByText('Données permanentes')).toBeInTheDocument();
    expect(screen.getByText('Année de naissance')).toBeInTheDocument(); // chip manquant
    expect(screen.getByText('Glasgow')).toBeInTheDocument();
    expect(screen.getAllByText('Brouillon').length).toBe(2); // StatusBadge

    // « Compléter » de la RENCONTRE ouvre l'edition de la rencontre.
    await userEvent.click(screen.getAllByRole('button', { name: 'Compléter' })[1]);
    expect(await screen.findByText('EDIT ENCOUNTER')).toBeInTheDocument();
  });

  test('file vide : message de felicitation', async () => {
    renderQueue({ getCompletionQueuePage: vi.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0, hasMore: false })) } as unknown as PatientRepository);
    expect(await screen.findByText(/Rien à compléter/)).toBeInTheDocument();
  });
});
