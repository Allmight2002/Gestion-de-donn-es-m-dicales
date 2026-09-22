// @vitest-environment jsdom
// L69 — creation d'un patient avec des occurrences TAMPONNEES (spec §8.3, §14.2 points 15 et 16).
//
// Ce qui est verifie ici n'est pas « l'ecran sait ajouter une ligne » mais le comportement en
// cas d'ECHEC : la fiche et les lignes deja ecrites existent, l'ecran nomme PRECISEMENT celles
// qui manquent, la reprise les ecrit — dans l'ordre, sans doublon — et rien n'est jamais
// affiche comme enregistre avant que le serveur l'ait confirme.
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
import { NewPatient } from './NewPatient';
import type { BaseListing, BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { NewEncounterInput, PatientRepository } from '../../data/patients';
import type { TemplateField, TemplateSection } from '../../data/types';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({
    profile: { id: 'u', fullName: 'M', globalRole: 'medecin', language: 'fr' },
    user: { id: 'u', email: null }, signOut: () => {},
  }),
}));

const listing: BaseListing = {
  base: { id: 'b1', name: 'B', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' },
  role: 'owner',
  permissions: {
    canViewIdentity: true, canViewRawDocuments: true, canEditStructuredData: true,
    canExportData: true, canManageAccess: true,
  },
  templateName: 'Neuro', versionNumber: 1,
};

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'type' | 'scope'>): TemplateField {
  return {
    id: p.fieldKey, section: 'clinique', unit: null, allowedValues: null, required: false,
    minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0, ...p,
  };
}

const sections: TemplateSection[] = [
  { id: 's-clinique', sectionKey: 'clinique', label: 'Clinique', displayOrder: 0 },
  { id: 's-lesions', sectionKey: 'lesions', label: 'Lésions', displayOrder: 1, isRepeatable: true },
];

const templateRepo = {
  async getVersion() {
    return {
      version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'published' as const },
      fields: [
        field({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'text' }),
        field({ fieldKey: 'niveau', label: 'Niveau', scope: 'encounter', type: 'text', section: 'lesions', displayOrder: 0 }),
      ],
      rules: [],
      sections,
    };
  },
} as unknown as TemplateRepository;

function makePatients(over: Partial<PatientRepository> = {}): PatientRepository {
  return {
    async listPatients() { return []; },
    async findIdentityMatches() { return []; },
    async computeAge() { return null; },
    async createPatient() { return { id: 'p1', code: 'P-0001' }; },
    async createEncounter() { return { id: 'o' }; },
    async listEncounters() { return []; },
    ...over,
  } as unknown as PatientRepository;
}

function renderNewPatient(patients: PatientRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider
        bases={{ async getBase() { return listing; } } as unknown as BaseRepository}
        templates={templateRepo}
        patients={patients}
      >
        <ToastProvider>
          <MemoryRouter initialEntries={['/bases/b1/patients/new/manual']}>
            <Routes>
              <Route path="/bases/:id/patients/new/manual" element={<NewPatient mode="manual" />} />
              <Route path="/bases/:id/patients/:patientId" element={<div>FICHE PATIENT</div>} />
              <Route path="/bases/:id" element={<div>ACCUEIL BASE</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

function BaseRouteLabel() {
  const { id } = useParams();
  return <p>BASE:{id}</p>;
}

function NavigateToSecondBase() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/bases/b2/patients/new/manual')}>Changer de base</button>;
}

function renderNewPatientWithBaseSwitch(patients: PatientRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider
        bases={{ async getBase(id: string) { return { ...listing, base: { ...listing.base, id, name: `Base ${id}` } }; } } as unknown as BaseRepository}
        templates={templateRepo}
        patients={patients}
      >
        <ToastProvider>
          <MemoryRouter initialEntries={['/bases/b1/patients/new/manual']}>
            <NavigateToSecondBase />
            <Routes>
              <Route path="/bases/:id/patients/new/manual" element={<><BaseRouteLabel /><NewPatient mode="manual" /></>} />
              <Route path="/bases/:id/patients/:patientId" element={<div>FICHE PATIENT</div>} />
              <Route path="/bases/:id" element={<div>ACCUEIL BASE</div>} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

/** Ouvre le bloc repetable, qui est une etape du formulaire comme les autres. */
async function openGroup(user: ReturnType<typeof userEvent.setup>) {
  const contents = await screen.findByRole('navigation', { name: 'Sommaire du formulaire' });
  await user.click(within(contents).getByRole('button', { name: 'Lésions' }));
  // Un groupe vide rend une ligne d'invite, jamais un tableau d'en-tetes nu (§8.1).
  await screen.findByRole('button', { name: 'Ajouter une occurrence' });
}

/** Saisit une occurrence et la conserve dans le tampon. Rien ne part au serveur ici. */
async function addOccurrence(user: ReturnType<typeof userEvent.setup>, niveau: string) {
  await user.click(screen.getByRole('button', { name: 'Ajouter une occurrence' }));
  await user.type(screen.getByRole('textbox', { name: /Niveau/ }), niveau);
  await user.click(screen.getByRole('button', { name: 'Conserver l’occurrence' }));
}

const occurrenceLevels = (createEncounter: ReturnType<typeof vi.fn>) =>
  createEncounter.mock.calls.map((call) => (call[1] as { data: { niveau: string } }).data.niveau);

describe('L69 — occurrences tamponnees a la creation', () => {
  // §14.2, point 15.
  test('trois occurrences tamponnees sont ecrites apres la fiche, dans l’ordre de saisie', async () => {
    const user = userEvent.setup();
    const createPatient = vi.fn(async () => ({ id: 'p1', code: 'P-0001' }));
    const createEncounter = vi.fn(async (_patientId: string, _input: NewEncounterInput, _operationKey: string) => ({ id: `o${createEncounter.mock.calls.length}` }));
    renderNewPatient(makePatients({ createPatient, createEncounter }));

    await openGroup(user);
    // Tant que la fiche n'existe pas, le tampon est vide et le dit.
    expect(screen.getByText('0 occurrence(s)')).toBeInTheDocument();

    await addOccurrence(user, 'C5');
    await addOccurrence(user, 'T3');
    await addOccurrence(user, 'L1');

    // Les trois lignes sont a l'ecran, et AUCUNE n'est partie : la fiche n'existe pas encore.
    const table = screen.getByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getAllByRole('row')).toHaveLength(4); // en-tete + trois occurrences
    expect(screen.getByText('3 occurrence(s)')).toBeInTheDocument();
    expect(screen.getAllByText('Non enregistrée')).toHaveLength(3);
    expect(createEncounter).not.toHaveBeenCalled();
    expect(createPatient).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));

    expect(await screen.findByText('FICHE PATIENT')).toBeInTheDocument();
    expect(createPatient).toHaveBeenCalledTimes(1);
    // Le rejeu suit l'ordre de SAISIE, et chaque ligne part avec son bloc.
    expect(createEncounter).toHaveBeenCalledTimes(3);
    expect(occurrenceLevels(createEncounter)).toEqual(['C5', 'T3', 'L1']);
    const operationKeys = createEncounter.mock.calls.map((call) => call[2] as string);
    expect(operationKeys.every((key) => key.startsWith('l69-occurrence:'))).toBe(true);
    expect(new Set(operationKeys).size).toBe(3);
    for (const call of createEncounter.mock.calls) {
      expect(call[0]).toBe('p1');
      expect(call[1]).toMatchObject({ groupSectionKey: 'lesions', encounterDate: null });
    }
  });

  // §14.2, point 16 — le coeur du lot.
  test('echec sur la deuxieme : la fiche et la premiere existent, les deux autres sont marquees non enregistrees, et la reprise les ecrit sans doublon', async () => {
    const user = userEvent.setup();
    // Petit dépôt à état : le test vérifie l'existence réelle dans sa base fictive, pas seulement
    // le nombre d'appels au repository.
    const persisted = {
      patients: [] as Array<{ id: string; code: string | null }>,
      occurrences: [] as Array<{ id: string; patientId: string; input: NewEncounterInput }>,
    };
    const createPatient = vi.fn(async (_baseId: string, input: Parameters<PatientRepository['createPatient']>[1]) => {
      const patient = { id: 'p1', code: input.code ?? 'P-0001' };
      persisted.patients.push(patient);
      return patient;
    });
    let failSecond = true;
    const createEncounter = vi.fn(async (patientId: string, input: NewEncounterInput, _operationKey: string) => {
      if (failSecond && input.data.niveau === 'T3') throw new Error('Occurrence refusée par la base');
      const occurrence = { id: `o-${input.data.niveau}`, patientId, input };
      persisted.occurrences.push(occurrence);
      return { id: occurrence.id };
    });
    renderNewPatient(makePatients({ createPatient, createEncounter }));

    await openGroup(user);
    await addOccurrence(user, 'C5');
    await addOccurrence(user, 'T3');
    await addOccurrence(user, 'L1');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));

    // La fiche est creee UNE fois, et l'ecran ne navigue pas : l'etat affiche est l'etat reel.
    const banner = await screen.findByRole('alert', { name: 'Occurrences non confirmées' });
    expect(createPatient).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('FICHE PATIENT')).not.toBeInTheDocument();
    expect(persisted.patients).toEqual([{ id: 'p1', code: 'P-0001' }]);
    expect(persisted.occurrences.map(({ input }) => input.data.niveau)).toEqual(['C5']);

    // La ligne qui echoue arrete le rejeu : la troisieme n'est pas tentee, sans quoi elle
    // passerait devant la deuxieme et l'ordre de saisie serait perdu.
    expect(createEncounter).toHaveBeenCalledTimes(2);
    expect(occurrenceLevels(createEncounter)).toEqual(['C5', 'T3']);

    // L'ecran nomme PRECISEMENT les lignes qui manquent, et porte le message de celle qui a
    // echoue. La premiere, elle, est bien enregistree.
    expect(banner).toHaveTextContent('Fiche P-0001 enregistrée. 1 occurrence(s) sur 3 écrite(s)');
    expect(within(banner).getByText('Lésions, occurrence 2')).toBeInTheDocument();
    expect(within(banner).getByText('Occurrence refusée par la base')).toBeInTheDocument();
    expect(within(banner).getByText('Lésions, occurrence 3')).toBeInTheDocument();
    expect(within(banner).getByText(/Pas encore tentée/)).toBeInTheDocument();
    expect(screen.getAllByText('Non enregistrée')).toHaveLength(2);
    expect(screen.getAllByText('Enregistrée')).toHaveLength(1);

    // Reprise : le serveur accepte de nouveau.
    failSecond = false;
    await user.click(within(banner).getByRole('button', { name: 'Reprendre les lignes restantes' }));

    expect(await screen.findByText('FICHE PATIENT')).toBeInTheDocument();
    // Quatre appels : C5, T3 (refusee), puis T3 et L1. La premiere ligne n'est JAMAIS renvoyee,
    // et la fiche n'est pas recreee.
    expect(createEncounter).toHaveBeenCalledTimes(4);
    expect(occurrenceLevels(createEncounter)).toEqual(['C5', 'T3', 'T3', 'L1']);
    const t3Keys = createEncounter.mock.calls
      .filter((call) => (call[1] as NewEncounterInput).data.niveau === 'T3')
      .map((call) => call[2]);
    expect(t3Keys).toHaveLength(2);
    expect(t3Keys[0]).toMatch(/^l69-occurrence:/);
    expect(t3Keys[1]).toBe(t3Keys[0]);
    expect(createPatient).toHaveBeenCalledTimes(1);
    expect(persisted.patients).toHaveLength(1);
    expect(persisted.occurrences.map(({ input }) => input.data.niveau)).toEqual(['C5', 'T3', 'L1']);
    expect(persisted.occurrences.every(({ patientId }) => patientId === 'p1')).toBe(true);
  });

  test('une réponse perdue reste incertaine et le même reçu retrouve la ligne sans doublon', async () => {
    const user = userEvent.setup();
    const persisted: Array<{ id: string; patientId: string; input: NewEncounterInput }> = [];
    const receipts = new Map<string, string>();
    let loseSecondResponse = true;
    const createEncounter = vi.fn(async (patientId: string, input: NewEncounterInput, operationKey: string) => {
      const existingId = receipts.get(operationKey);
      if (existingId) return { id: existingId };
      const occurrence = { id: `o-${input.data.niveau}`, patientId, input };
      receipts.set(operationKey, occurrence.id);
      persisted.push(occurrence);
      if (input.data.niveau === 'T3' && loseSecondResponse) {
        loseSecondResponse = false;
        throw new TypeError('Failed to fetch');
      }
      return { id: occurrence.id };
    });
    renderNewPatient(makePatients({ createEncounter }));

    await openGroup(user);
    await addOccurrence(user, 'C5');
    await addOccurrence(user, 'T3');
    await addOccurrence(user, 'L1');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));

    const banner = await screen.findByRole('alert', { name: 'Occurrences non confirmées' });
    expect(banner).toHaveTextContent('confirmation incertaine');
    expect(within(banner).getByText('Lésions, occurrence 2')).toBeInTheDocument();
    expect(within(banner).getByText(/La réponse du serveur a pu se perdre/)).toBeInTheDocument();
    const uncertainRow = within(banner).getByText('Lésions, occurrence 2').closest('li')!;
    expect(within(uncertainRow).queryByRole('button', { name: 'Abandonner cette ligne' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Confirmation incertaine')).toHaveLength(1);
    expect(screen.getAllByText('Non enregistrée')).toHaveLength(1);
    expect(persisted.map(({ input }) => input.data.niveau)).toEqual(['C5', 'T3']);

    await user.click(within(banner).getByRole('button', { name: 'Reprendre les lignes restantes' }));

    expect(await screen.findByText('FICHE PATIENT')).toBeInTheDocument();
    expect(occurrenceLevels(createEncounter)).toEqual(['C5', 'T3', 'T3', 'L1']);
    const t3Keys = createEncounter.mock.calls
      .filter((call) => (call[1] as NewEncounterInput).data.niveau === 'T3')
      .map((call) => call[2]);
    expect(t3Keys).toHaveLength(2);
    expect(t3Keys[1]).toBe(t3Keys[0]);
    expect(persisted.map(({ input }) => input.data.niveau)).toEqual(['C5', 'T3', 'L1']);
  });

  test('la reprise ligne par ligne n’ecrit qu’une occurrence a la fois, dans l’ordre', async () => {
    const user = userEvent.setup();
    let accept = false;
    const createEncounter = vi.fn(async (_patientId: string, input: NewEncounterInput) => {
      if (!accept && input.data.niveau !== 'C5') throw new Error('Serveur indisponible');
      return { id: `o-${input.data.niveau}` };
    });
    renderNewPatient(makePatients({ createEncounter }));

    await openGroup(user);
    await addOccurrence(user, 'C5');
    await addOccurrence(user, 'T3');
    await addOccurrence(user, 'L1');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));

    const banner = await screen.findByRole('alert', { name: 'Occurrences non confirmées' });
    accept = true;
    await user.click(within(banner).getByRole('button', { name: 'Reprendre la ligne suivante' }));

    // Une seule ligne est partie : la deuxieme. La troisieme attend encore.
    expect(occurrenceLevels(createEncounter)).toEqual(['C5', 'T3', 'T3']);
    expect(screen.queryByText('FICHE PATIENT')).not.toBeInTheDocument();
    expect(await screen.findByText('Non enregistrée')).toBeInTheDocument();
    expect(screen.getAllByText('Enregistrée')).toHaveLength(2);

    await user.click(within(await screen.findByRole('alert', { name: 'Occurrences non confirmées' })).getByRole('button', { name: 'Reprendre la ligne suivante' }));
    expect(await screen.findByText('FICHE PATIENT')).toBeInTheDocument();
    expect(occurrenceLevels(createEncounter)).toEqual(['C5', 'T3', 'T3', 'L1']);
  });

  test('une ligne que le serveur refuse peut etre abandonnee ; les autres partent quand meme', async () => {
    const user = userEvent.setup();
    const createEncounter = vi.fn(async (_patientId: string, input: NewEncounterInput) => {
      if (input.data.niveau === 'T3') throw new Error('Occurrence refusée par la base');
      return { id: `o-${input.data.niveau}` };
    });
    renderNewPatient(makePatients({ createEncounter }));

    await openGroup(user);
    await addOccurrence(user, 'C5');
    await addOccurrence(user, 'T3');
    await addOccurrence(user, 'L1');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));

    const banner = await screen.findByRole('alert', { name: 'Occurrences non confirmées' });
    const rejected = within(banner).getByText('Lésions, occurrence 2').closest('li')!;
    await user.click(within(rejected).getByRole('button', { name: 'Abandonner cette ligne' }));
    await user.click(within(await screen.findByRole('alert', { name: 'Occurrences non confirmées' })).getByRole('button', { name: 'Reprendre les lignes restantes' }));

    expect(await screen.findByText('FICHE PATIENT')).toBeInTheDocument();
    expect(occurrenceLevels(createEncounter)).toEqual(['C5', 'T3', 'L1']);
  });

  test('quitter l’ecran avec des lignes non enregistrees demande confirmation', async () => {
    const user = userEvent.setup();
    renderNewPatient(makePatients());

    await openGroup(user);
    await addOccurrence(user, 'C5');

    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    // La sortie est retenue tant que la confirmation n'est pas donnee.
    expect(await screen.findByRole('dialog')).toHaveTextContent('Quitter cette saisie ?');
    expect(screen.queryByText('ACCUEIL BASE')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Quitter la saisie' }));
    expect(await screen.findByText('ACCUEIL BASE')).toBeInTheDocument();
  });

  test('quitter pendant la saisie d’une occurrence non conservée demande confirmation', async () => {
    const user = userEvent.setup();
    renderNewPatient(makePatients());

    await openGroup(user);
    await user.click(screen.getByRole('button', { name: 'Ajouter une occurrence' }));
    await user.type(screen.getByRole('textbox', { name: /Niveau/ }), 'C5');

    const cancelButtons = screen.getAllByRole('button', { name: 'Annuler' });
    await user.click(cancelButtons.at(-1)!);

    expect(await screen.findByRole('dialog')).toHaveTextContent('Les modifications les plus récentes');
    expect(screen.queryByText('ACCUEIL BASE')).not.toBeInTheDocument();
  });

  test('enregistrer le patient pendant la saisie d’une occurrence est bloqué sans perdre les valeurs', async () => {
    const user = userEvent.setup();
    const createPatient = vi.fn(async () => ({ id: 'p1', code: 'P-0001' }));
    const createEncounter = vi.fn(async () => ({ id: 'o1' }));
    renderNewPatient(makePatients({ createPatient, createEncounter }));

    await openGroup(user);
    await user.click(screen.getByRole('button', { name: 'Ajouter une occurrence' }));
    const input = screen.getByRole('textbox', { name: /Niveau/ });
    await user.type(input, 'C5');

    const save = screen.getByRole('button', { name: 'Enregistrer le patient' });
    expect(save).toBeDisabled();
    expect(screen.getByText(/Conservez ou annulez l’occurrence en cours/)).toBeInTheDocument();
    fireEvent.submit(input.closest('form')!);

    expect(createPatient).not.toHaveBeenCalled();
    expect(createEncounter).not.toHaveBeenCalled();
    expect(input).toHaveValue('C5');
  });

  test('ajouter, modifier ou retirer une autre occurrence ne remplace pas le brouillon ouvert', async () => {
    const user = userEvent.setup();
    renderNewPatient(makePatients());

    await openGroup(user);
    await addOccurrence(user, 'C5');
    await addOccurrence(user, 'T3');

    await user.click(screen.getByRole('button', { name: 'Modifier l’occurrence 1 de Lésions' }));
    const input = screen.getByRole('textbox', { name: /Niveau/ });
    await user.clear(input);
    await user.type(input, 'L1');

    expect(screen.getByRole('button', { name: 'Ajouter une occurrence' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Modifier l’occurrence 2 de Lésions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Supprimer l’occurrence 2 de Lésions' })).toBeDisabled();
    expect(screen.getByText(/avant d’en ajouter, d’en modifier ou d’en supprimer une autre/)).toBeInTheDocument();
    expect(input).toHaveValue('L1');

    await user.click(screen.getByRole('button', { name: 'Conserver l’occurrence' }));
    expect(screen.queryByRole('textbox', { name: /Niveau/ })).not.toBeInTheDocument();
    expect(screen.getByText('L1')).toBeInTheDocument();
    expect(screen.getByText('T3')).toBeInTheDocument();
  });

  test('un changement de base confirmé repart sans tampon ni brouillon d’occurrence de la base précédente', async () => {
    const user = userEvent.setup();
    const createPatient = vi.fn(async (baseId: string) => ({ id: `${baseId}-patient`, code: `${baseId}-P1` }));
    const createEncounter = vi.fn(async (patientId: string, input: NewEncounterInput) => ({ id: `${patientId}-${input.data.niveau}` }));
    renderNewPatientWithBaseSwitch(makePatients({ createPatient, createEncounter }));

    await openGroup(user);
    await addOccurrence(user, 'C5');
    await user.click(screen.getByRole('button', { name: 'Ajouter une occurrence' }));
    await user.type(screen.getByRole('textbox', { name: /Niveau/ }), 'T3');

    await user.click(screen.getByRole('button', { name: 'Changer de base' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Quitter cette saisie ?');
    await user.click(screen.getByRole('button', { name: 'Quitter la saisie' }));

    expect(await screen.findByText('BASE:b2')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Niveau/ })).not.toBeInTheDocument();
    await openGroup(user);
    expect(screen.getByText('0 occurrence(s)')).toBeInTheDocument();

    await addOccurrence(user, 'L1');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le patient' }));
    expect(await screen.findByText('FICHE PATIENT')).toBeInTheDocument();
    expect(createPatient).toHaveBeenCalledTimes(1);
    expect(createPatient.mock.calls[0][0]).toBe('b2');
    expect(createEncounter).toHaveBeenCalledTimes(1);
    expect(createEncounter.mock.calls[0][0]).toBe('b2-patient');
    expect((createEncounter.mock.calls[0][1] as NewEncounterInput).data.niveau).toBe('L1');
  });
});
