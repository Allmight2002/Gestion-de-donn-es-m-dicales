// @vitest-environment jsdom
// Hors-ligne (§13, Phase 1) : rendu en LECTURE SEULE depuis le cache analytique.
// Prouve que (1) les donnees analytiques s'affichent sans reseau, (2) l'identite et les
// actions d'ecriture sont absentes, (3) aucun appel repo (reseau) n'est fait hors-ligne.
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseHome } from './BaseHome';
import { PatientDetail } from './PatientDetail';
import { buildSnapshot, offlineCache } from '../../data/offline';
import type { BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository } from '../../data/patients';
import type { AttachmentRepository } from '../../data/attachments';

// Repos qui ECHOUENT a tout appel : hors-ligne, aucune lecture reseau ne doit avoir lieu.
const forbidNetwork = new Proxy(
  {},
  { get: () => async () => { throw new Error('reseau interdit hors-ligne'); } },
) as unknown as BaseRepository & TemplateRepository & PatientRepository & AttachmentRepository;

function renderAt(path: string, element: React.ReactNode, routePath: string) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={forbidNetwork} templates={forbidNetwork} patients={forbidNetwork} attachments={forbidNetwork}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

beforeAll(async () => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
  await offlineCache.save(
    buildSnapshot(
      { id: 'b1', name: 'Base hors-ligne', templateVersionId: 'v1' },
      [{ id: 'p-off', code: 'P-OFF', templateVersionId: 'v1', data: { sexe: 'M' }, validationStatus: 'curated' }],
      { 'p-off': [{ id: 'e1', encounterType: 'consultation', encounterDate: '2024-06-01', validationStatus: 'curated', ageValue: 44, ageUnit: 'years', data: { glasgow_score: 12 } }] },
      [
        { id: 'f1', fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', displayOrder: 0 },
        { id: 'f2', fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', type: 'integer', displayOrder: 1 },
      ],
    ),
  );
});

afterAll(async () => {
  await offlineCache.remove('b1');
});

describe('BaseHome hors-ligne', () => {
  test('liste les patients depuis le cache (analytique), sans identite ni actions d ecriture', async () => {
    renderAt('/bases/b1', <BaseHome />, '/bases/:id');
    expect(await screen.findByText('Base hors-ligne')).toBeInTheDocument();
    expect(screen.getByText('P-OFF')).toBeInTheDocument(); // code patient
    expect(screen.getByText('Sexe')).toBeInTheDocument(); // colonne analytique
    expect(screen.getByText('M')).toBeInTheDocument(); // valeur analytique
    expect(screen.getByText('Lecture seule (hors-ligne)')).toBeInTheDocument();
    // Pas de colonne identite, pas de bouton de creation.
    expect(screen.queryByText('Nom complet')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nouveau patient/)).not.toBeInTheDocument();
  });
});

describe('PatientDetail hors-ligne', () => {
  test('affiche analytique + rencontres, masque identite/images et actions d ecriture', async () => {
    renderAt('/bases/b1/patients/p-off', <PatientDetail />, '/bases/:id/patients/:patientId');
    expect(await screen.findByText('P-OFF')).toBeInTheDocument();
    expect(screen.getByText('Sexe')).toBeInTheDocument();
    expect(screen.getByText('Glasgow')).toBeInTheDocument(); // libelle rencontre
    expect(screen.getByText('12')).toBeInTheDocument(); // valeur rencontre
    expect(screen.getByText('Lecture seule (hors-ligne)')).toBeInTheDocument();
    // Aucune action d'ecriture hors-ligne.
    expect(screen.queryByRole('button', { name: 'Supprimer ce patient' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Section identité|Identité/)).not.toBeInTheDocument();
  });
});
