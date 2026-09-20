// @vitest-environment jsdom
// Hors-ligne (§13, Phase 1) : rendu en LECTURE SEULE depuis le cache analytique.
// Prouve que (1) les donnees analytiques s'affichent sans reseau, (2) l'identite et les
// actions d'ecriture sont absentes, (3) aucun appel repo (reseau) n'est fait hors-ligne.
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { BaseHome } from './BaseHome';
import { PatientDetail } from './PatientDetail';
import { EditEncounter } from './EditEncounter';
import { buildSnapshot, offlineCache, outbox, setOfflineUser } from '../../data/offline';
import type { BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository } from '../../data/patients';
import type { AttachmentRepository } from '../../data/attachments';

// EditEncounter lit le role global (profil de medecin par defaut pour ces tests).
vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'u', fullName: 'M', globalRole: 'medecin', language: 'fr' }, user: { id: 'u', email: null }, signOut: () => {} }),
}));

// Repos qui ECHOUENT a tout appel : hors-ligne, aucune lecture reseau ne doit avoir lieu.
const forbidNetwork = new Proxy(
  {},
  { get: () => async () => { throw new Error('reseau interdit hors-ligne'); } },
) as unknown as BaseRepository & TemplateRepository & PatientRepository & AttachmentRepository;

const offlineSections = [
  { id: 's-clinique', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0, parentSectionKey: null, isRepeatable: false },
  { id: 's-group-a', sectionKey: 'group_a', label: 'Groupe A', displayOrder: 1, parentSectionKey: null, isRepeatable: true },
];
const offlineFields = [
  { id: 'f1', fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', displayOrder: 0 },
  { id: 'f2', fieldKey: 'glasgow_score', label: 'Glasgow', scope: 'encounter', type: 'integer', displayOrder: 1, section: 'clinique' },
  { id: 'f3', fieldKey: 'group_marker', label: 'Valeur de groupe', scope: 'encounter', type: 'text', displayOrder: 2, section: 'group_a' },
];

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
  vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  vi.stubEnv('VITE_OFFLINE_ADMIN_ACK', 'true');
  setOfflineUser('offline-read-user');
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
  await offlineCache.save(
    buildSnapshot(
      { id: 'b1', name: 'Base hors-ligne', templateVersionId: 'v1' },
      [{ id: 'p-off', code: 'P-OFF', templateVersionId: 'v1', data: { sexe: 'M' }, validationStatus: 'curated' }],
      { 'p-off': [{ id: 'e1', encounterType: 'consultation', encounterDate: '2024-06-01', validationStatus: 'curated', ageValue: 44, ageUnit: 'years', data: { glasgow_score: 12, group_marker: 'SENTINEL-GROUP-VALUE' }, updatedAt: '2024-06-01T08:00:00.000Z', groupSectionKey: null, templateVersionId: 'v1' }] },
      offlineFields,
      Date.now(),
      { v1: offlineFields },
      {},
      offlineSections,
      { v1: offlineSections },
    ),
  );
});

afterAll(async () => {
  await offlineCache.remove('b1');
  setOfflineUser(null);
  vi.unstubAllEnvs();
});

describe('BaseHome hors-ligne', () => {
  test('liste les patients depuis le cache (analytique), sans identite ni actions d ecriture', async () => {
    renderAt('/bases/b1', <BaseHome />, '/bases/:id');
    expect(await screen.findByText('Base hors-ligne')).toBeInTheDocument();
    expect(screen.getByText('P-OFF')).toBeInTheDocument(); // code patient
    expect(screen.getByRole('columnheader', { name: 'Sexe' })).toBeInTheDocument(); // colonne analytique
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
    expect(screen.queryByText('SENTINEL-GROUP-VALUE')).not.toBeInTheDocument();
    expect(screen.queryByText('Valeur de groupe')).not.toBeInTheDocument();
    expect(screen.getByText('Lecture seule (hors-ligne)')).toBeInTheDocument();
    // Aucune action d'ecriture hors-ligne.
    expect(screen.queryByRole('button', { name: 'Supprimer ce patient' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Section identité|Identité/)).not.toBeInTheDocument();
  });

  test('un ancien cache sans marqueur de groupe masque les valeurs de rencontre', async () => {
    await offlineCache.save(buildSnapshot(
      { id: 'b-old-cache', name: 'Ancien cache', templateVersionId: 'v-old' },
      [{ id: 'p-old-cache', code: 'P-OLD', templateVersionId: 'v-old', data: {}, validationStatus: 'curated' }],
      { 'p-old-cache': [{ id: 'e-old-cache', encounterType: 'consultation', encounterDate: '2024-01-01', validationStatus: 'curated', ageValue: null, ageUnit: null, data: { glasgow_score: 77 } }] },
      [{ id: 'f-old', fieldKey: 'glasgow_score', label: 'Glasgow (cache ancien)', scope: 'encounter', type: 'integer', displayOrder: 0 }],
    ));
    renderAt('/bases/b-old-cache/patients/p-old-cache', <PatientDetail />, '/bases/:id/patients/:patientId');
    expect(await screen.findByText(/Reconnectez-vous et actualisez la copie hors-ligne/)).toBeInTheDocument();
    expect(screen.queryByText('77')).not.toBeInTheDocument();
    expect(screen.queryByText('Glasgow (cache ancien)')).not.toBeInTheDocument();
    await offlineCache.remove('b-old-cache');
  });

  test('L71 : une occurrence affiche les valeurs de SON groupe en lecture hors-ligne', async () => {
    await offlineCache.save(buildSnapshot(
      { id: 'b-grouped-cache', name: 'Cache groupé', templateVersionId: 'v1' },
      [{ id: 'p-grouped-cache', code: 'P-GROUP', templateVersionId: 'v1', data: {}, validationStatus: 'curated' }],
      { 'p-grouped-cache': [{ id: 'e-grouped-cache', encounterType: 'consultation', encounterDate: '2024-01-01', validationStatus: 'curated', ageValue: null, ageUnit: null, data: { glasgow_score: 88, group_marker: 'GROUP-VALUE' }, groupSectionKey: 'group_a', templateVersionId: 'v1' }] },
      offlineFields,
      Date.now(),
      { v1: offlineFields },
      {},
      offlineSections,
      { v1: offlineSections },
    ));
    renderAt('/bases/b-grouped-cache/patients/p-grouped-cache', <PatientDetail />, '/bases/:id/patients/:patientId');
    expect(await screen.findByText('GROUP-VALUE')).toBeInTheDocument();
    expect(screen.queryByText(/ne sont pas disponibles hors ligne/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reconnectez-vous et actualisez la copie hors-ligne/)).not.toBeInTheDocument();
    // §5 : une variable du bloc ordinaire ne s'applique pas à une occurrence.
    expect(screen.queryByText('88')).not.toBeInTheDocument();
    await offlineCache.remove('b-grouped-cache');
  });

  test('une occurrence dont la copie ne prouve pas la portée reste sans valeurs', async () => {
    await offlineCache.save(buildSnapshot(
      { id: 'b-grouped-unknown', name: 'Cache groupé sans version', templateVersionId: 'v1' },
      [{ id: 'p-grouped-unknown', code: 'P-GROUP-UNK', templateVersionId: 'v1', data: {}, validationStatus: 'curated' }],
      // Sans templateVersionId sur la rencontre, rien ne dit quel dictionnaire classe ses valeurs.
      { 'p-grouped-unknown': [{ id: 'e-grouped-unknown', encounterType: 'consultation', encounterDate: '2024-01-01', validationStatus: 'curated', ageValue: null, ageUnit: null, data: { group_marker: 'UNKNOWN-SENTINEL' }, groupSectionKey: 'group_a' }] },
      offlineFields,
      Date.now(),
      { v1: offlineFields },
      {},
      offlineSections,
      { v1: offlineSections },
    ));
    renderAt('/bases/b-grouped-unknown/patients/p-grouped-unknown', <PatientDetail />, '/bases/:id/patients/:patientId');
    expect(await screen.findByText(/Reconnectez-vous et actualisez la copie hors-ligne/)).toBeInTheDocument();
    expect(screen.queryByText('UNKNOWN-SENTINEL')).not.toBeInTheDocument();
    await offlineCache.remove('b-grouped-unknown');
  });
});

describe('EditEncounter hors-ligne §7.4/§7.5 (version historique)', () => {
  test('utilise le dictionnaire DE LA rencontre (fieldsByVersion), et un dico minimal reste affichable', async () => {
    await offlineCache.save(
      buildSnapshot(
        { id: 'b2', name: 'Base multi-versions', templateVersionId: 'v2' },
        [{ id: 'p2', code: 'P-2', templateVersionId: 'v2', data: {}, validationStatus: 'curated' }],
        { p2: [{ id: 'e2', encounterType: 'consultation', encounterDate: '2024-01-01', validationStatus: 'curated', ageValue: null, ageUnit: null, data: { glasgow_score: 9 }, updatedAt: null, templateVersionId: 'v-old', groupSectionKey: null }] },
        // Dictionnaire de la version COURANTE (v2) : ne doit PAS etre utilise pour cette rencontre.
        [{ id: 'f2', fieldKey: 'glasgow_score', label: 'Glasgow v2', scope: 'encounter', type: 'integer', displayOrder: 0 }],
        Date.now(),
        // Dictionnaire de la version DE LA rencontre (v-old), volontairement SANS `section`
        // l'inventaire versionnel explicite ci-dessous garantit l'absence de section répétable.
        { 'v-old': [{ id: 'f1', fieldKey: 'glasgow_score', label: 'Glasgow (ancien)', scope: 'encounter', type: 'integer', displayOrder: 0 }] },
        undefined,
        [{ id: 's-clinique-old', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0, isRepeatable: false }],
        { 'v-old': [] },
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
            groupSectionKey: null,
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
        undefined,
        { 'v-rule': [{ id: 's-clinique-rule', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0, isRepeatable: false }] },
      ),
    );

    renderAt('/bases/b-rules/patients/p-rules/encounters/e-rules/edit', <EditEncounter />, '/bases/:id/patients/:patientId/encounters/:encounterId/edit');
    expect(await screen.findByText('Admission')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'controle regle' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));

    // UX-13 : le message apparait deux fois — dans le resume d'erreurs et sous le champ.
    expect(await screen.findAllByText('Sortie >= admission')).not.toHaveLength(0);
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
    expect(entry.groupSectionKey).toBeNull();
    expect(entry.data).not.toHaveProperty('group_marker');
    await outbox.remove(entry.id);
  });

  test('L71 : une occurrence se corrige hors-ligne, avec les champs de SON groupe', async () => {
    await offlineCache.save(buildSnapshot(
      { id: 'b-group-edit', name: 'Cache groupé', templateVersionId: 'v1' },
      [{ id: 'p-group-edit', code: 'P-GROUP', templateVersionId: 'v1', data: {}, validationStatus: 'curated' }],
      { 'p-group-edit': [{ id: 'e-group-edit', encounterType: 'consultation', encounterDate: '2024-01-01', validationStatus: 'curated', ageValue: null, ageUnit: null, data: { glasgow_score: 99, group_marker: 'GROUP-SENTINEL' }, groupSectionKey: 'group_a', templateVersionId: 'v1' }] },
      offlineFields,
      Date.now(),
      { v1: offlineFields },
      {},
      offlineSections,
      { v1: offlineSections },
    ));
    renderAt('/bases/b-group-edit/patients/p-group-edit/encounters/e-group-edit/edit', <EditEncounter />, '/bases/:id/patients/:patientId/encounters/:encounterId/edit');
    expect(await screen.findByLabelText('Valeur de groupe')).toHaveValue('GROUP-SENTINEL');
    // §5 : le bloc ordinaire n'appartient pas à la portée de cette ligne.
    expect(screen.queryByLabelText('Glasgow')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/motif de la correction/i), { target: { value: 'corr occurrence' } });
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer la rencontre' }));
    await waitFor(async () => expect(await outbox.count('b-group-edit')).toBe(1));
    const queued = (await outbox.list('b-group-edit'))[0];
    expect(queued.groupSectionKey).toBe('group_a');
    expect(queued.data).toEqual({ group_marker: 'GROUP-SENTINEL' });
    await outbox.remove(queued.id);
    await offlineCache.remove('b-group-edit');
  });

  test('bloque une ancienne rencontre sans marqueur ou inventaire de sections', async () => {
    await offlineCache.save(buildSnapshot(
      { id: 'b-unknown-edit', name: 'Cache ancien', templateVersionId: 'v-old' },
      [{ id: 'p-unknown-edit', code: 'P-UNKNOWN', templateVersionId: 'v-old', data: {}, validationStatus: 'curated' }],
      { 'p-unknown-edit': [{ id: 'e-unknown-edit', encounterType: 'consultation', encounterDate: '2024-01-01', validationStatus: 'curated', ageValue: null, ageUnit: null, data: { glasgow_score: 66 }, templateVersionId: 'v-old' }] },
      [{ id: 'f-old', fieldKey: 'glasgow_score', label: 'Glasgow ancien', scope: 'encounter', type: 'integer', displayOrder: 0 }],
    ));
    renderAt('/bases/b-unknown-edit/patients/p-unknown-edit/encounters/e-unknown-edit/edit', <EditEncounter />, '/bases/:id/patients/:patientId/encounters/:encounterId/edit');
    expect(await screen.findByRole('alert')).toHaveTextContent('Reconnectez-vous pour la modifier en ligne');
    expect(screen.queryByLabelText('Glasgow ancien')).not.toBeInTheDocument();
    expect(screen.queryByText('66')).not.toBeInTheDocument();
    expect(await outbox.count('b-unknown-edit')).toBe(0);
    await offlineCache.remove('b-unknown-edit');
  });
});
