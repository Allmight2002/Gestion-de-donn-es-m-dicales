// @vitest-environment jsdom
// Hors-ligne (§13, Phase 1) : rendu en LECTURE SEULE depuis le cache analytique.
// Prouve que (1) les donnees analytiques s'affichent sans reseau, (2) l'identite et les
// actions d'ecriture sont absentes, (3) aucun appel repo (reseau) n'est fait hors-ligne.
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseHome } from './BaseHome';
import { PatientDetail } from './PatientDetail';
import { EditEncounter } from './EditEncounter';
import { buildSnapshot, offlineCache, outbox } from '../../data/offline';
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
      { 'p-off': [{ id: 'e1', encounterType: 'consultation', encounterDate: '2024-06-01', validationStatus: 'curated', ageValue: 44, ageUnit: 'years', data: { glasgow_score: 12 }, updatedAt: '2024-06-01T08:00:00.000Z' }] },
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

describe('EditEncounter hors-ligne §7.4/§7.5 (version historique)', () => {
  test('utilise le dictionnaire DE LA rencontre (fieldsByVersion), et un dico minimal reste affichable', async () => {
    await offlineCache.save(
      buildSnapshot(
        { id: 'b2', name: 'Base multi-versions', templateVersionId: 'v2' },
        [{ id: 'p2', code: 'P-2', templateVersionId: 'v2', data: {}, validationStatus: 'curated' }],
        { p2: [{ id: 'e2', encounterType: 'consultation', encounterDate: '2024-01-01', validationStatus: 'curated', ageValue: null, ageUnit: null, data: { glasgow_score: 9 }, updatedAt: null, templateVersionId: 'v-old' }] },
        // Dictionnaire de la version COURANTE (v2) : ne doit PAS etre utilise pour cette rencontre.
        [{ id: 'f2', fieldKey: 'glasgow_score', label: 'Glasgow v2', scope: 'encounter', type: 'integer', displayOrder: 0 }],
        Date.now(),
        // Dictionnaire de la version DE LA rencontre (v-old), volontairement SANS `section`
        // (comme un instantane anterieur au §7.5) -> le repli section='clinique' doit l'afficher.
        { 'v-old': [{ id: 'f1', fieldKey: 'glasgow_score', label: 'Glasgow (ancien)', scope: 'encounter', type: 'integer', displayOrder: 0 }] },
      ),
    );
    renderAt('/bases/b2/patients/p2/encounters/e2/edit', <EditEncounter />, '/bases/:id/patients/:patientId/encounters/:encounterId/edit');
    expect(await screen.findByText('Glasgow (ancien)')).toBeInTheDocument(); // dico de LA rencontre, affiche malgre l'absence de section
    expect(screen.queryByText('Glasgow v2')).not.toBeInTheDocument(); // pas le dico de la version courante
    await offlineCache.remove('b2');
  });

  test('applique les regles de validation DE LA version hors-ligne avant mise en file', async () => {
    await offlineCache.save(
      buildSnapshot(
        { id: 'b-rules', name: 'Base regles', templateVersionId: 'v-current' },
        [{ id: 'p-rules', code: 'P-R', templateVersionId: 'v-rule', data: {}, validationStatus: 'curated' }],
        {
          'p-rules': [{
            id: 'e-rules',
            encounterType: 'hospitalisation',
            encounterDate: '2024-01-01',
            validationStatus: 'curated',
            ageValue: null,
            ageUnit: null,
            data: { admission_date: '2024-01-05', discharge_date: '2024-01-01' },
            updatedAt: '2024-01-01T00:00:00.000Z',
            templateVersionId: 'v-rule',
          }],
        },
        [{ id: 'f-current', fieldKey: 'admission_date', label: 'Admission courante', scope: 'encounter', type: 'date', displayOrder: 0 }],
        Date.now(),
        {
          'v-rule': [
            { id: 'f-adm', fieldKey: 'admission_date', label: 'Admission', scope: 'encounter', type: 'date', displayOrder: 0, section: 'clinique' },
            { id: 'f-dis', fieldKey: 'discharge_date', label: 'Sortie', scope: 'encounter', type: 'date', displayOrder: 1, section: 'clinique' },
          ],
        },
        {
          'v-rule': [{
            id: 'r-discharge',
            rule: { operator: 'greater_or_equal', left_field: 'discharge_date', right_field: 'admission_date' },
            message: 'Sortie >= admission',
            severity: 'block',
          }],
        },
      ),
    );

    renderAt('/bases/b-rules/patients/p-rules/encounters/e-rules/edit', <EditEncounter />, '/bases/:id/patients/:patientId/encounters/:encounterId/edit');
    expect(await screen.findByText('Admission')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'controle regle' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));

    expect(await screen.findByText('Sortie >= admission')).toBeInTheDocument();
    expect(await outbox.count('b-rules')).toBe(0);
    await offlineCache.remove('b-rules');
  });
});

describe('EditEncounter hors-ligne (Phase 2)', () => {
  test('la correction est MISE EN FILE (outbox), sans appel reseau', async () => {
    renderAt('/bases/b1/patients/p-off/encounters/e1/edit', <EditEncounter />, '/bases/:id/patients/:patientId/encounters/:encounterId/edit');
    // Bandeau hors-ligne + champ pre-rempli depuis le cache.
    expect(await screen.findByText(/mise en file d’attente/)).toBeInTheDocument();
    // Motif requis puis enregistrement -> enqueue (aucun repo appele, sinon "reseau interdit").
    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'corr hors-ligne' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    await waitFor(async () => expect(await outbox.count('b1')).toBe(1));
    const entry = (await outbox.list('b1'))[0];
    expect(entry.encounterId).toBe('e1');
    expect(entry.reason).toBe('corr hors-ligne');
    expect(entry.baseUpdatedAt).toBe('2024-06-01T08:00:00.000Z'); // jeton optimiste du cache
    await outbox.remove(entry.id);
  });
});
