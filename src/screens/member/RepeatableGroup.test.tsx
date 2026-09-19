import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { Encounter, PatientRepository } from '../../data/patients';
import type { TemplateField, TemplateSection, ValidationRule } from '../../data/types';
import { makeMissing } from '../../domain/validation';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepeatableGroup } from './RepeatableGroup';

const groupSection: TemplateSection = {
  id: 'section-lesions', sectionKey: 'lesions', label: 'Lésions', displayOrder: 1, isRepeatable: true,
};

function field(
  input: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'type'>,
): TemplateField {
  return {
    id: input.fieldKey,
    scope: 'encounter',
    section: 'clinique',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 0,
    ...input,
  };
}

function occurrence(
  id: string,
  data: Record<string, unknown> = { niveau: 'C5' },
  updatedAt = '2026-09-18T10:00:00.000Z',
  validationStatus = 'complete',
): Encounter {
  return {
    id,
    encounterType: 'autre',
    encounterDate: null,
    validationStatus,
    ageValue: null,
    ageUnit: 'years',
    data,
    updatedAt,
    groupSectionKey: 'lesions',
  };
}

function makePatients(overrides: Partial<PatientRepository> = {}): PatientRepository {
  return {
    async createEncounter() { return { id: 'created-occurrence' }; },
    async listEncounters() { return []; },
    async getEncounter() { return null; },
    async updateEncounter() { return { id: 'updated-occurrence' }; },
    async softDeleteEncounter() {},
    ...overrides,
  } as unknown as PatientRepository;
}

type GroupOptions = {
  fields?: TemplateField[];
  section?: TemplateSection;
  rows?: readonly Encounter[] | null;
  patientId?: string | null;
  canWrite?: boolean;
  online?: boolean;
  occurrencesError?: string | null;
  rules?: readonly ValidationRule[];
  requireComplete?: boolean;
  patients?: PatientRepository;
  onChanged?: () => void | Promise<void>;
  occurrenceTemplateVersionId?: string;
  canCreate?: boolean;
  totalOccurrenceCount?: number;
};

function groupUi(options: GroupOptions = {}) {
  const props = {
    section: groupSection,
    fields: [field({ fieldKey: 'niveau', label: 'Niveau', type: 'text' })],
    rows: [],
    patientId: 'patient-1',
    canWrite: true,
    online: true,
    occurrencesError: null,
    rules: [],
    requireComplete: false,
    patients: makePatients(),
    onChanged: vi.fn(),
    ...options,
  };

  return (
    <I18nProvider>
      <RepositoryProvider patients={props.patients}>
        <RepeatableGroup
          section={props.section}
          fields={props.fields}
          occurrences={props.rows}
          patientId={props.patientId}
          canWrite={props.canWrite}
          online={props.online}
          occurrencesError={props.occurrencesError}
          rules={props.rules}
          requireComplete={props.requireComplete}
          onChanged={props.onChanged}
          occurrenceTemplateVersionId={props.occurrenceTemplateVersionId}
          canCreate={props.canCreate}
          totalOccurrenceCount={props.totalOccurrenceCount}
        />
      </RepositoryProvider>
    </I18nProvider>
  );
}

function renderGroup(options: GroupOptions = {}) {
  return render(groupUi(options));
}

const originalMatchMedia = window.matchMedia;

function mockMatchMedia(initialMatch: boolean) {
  let matches = initialMatch;
  const listeners = new Set<() => void>();
  const media = {
    get matches() { return matches; },
    media: '(max-width: 767px)',
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  } as unknown as MediaQueryList;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => media),
  });

  return {
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function columns(count: number): TemplateField[] {
  return Array.from({ length: count }, (_, index) => field({
    fieldKey: 'field-' + (index + 1),
    label: 'Colonne ' + (index + 1),
    type: 'text',
    displayOrder: index,
  }));
}

beforeEach(() => {
  localStorage.setItem('registre.lang', 'fr');
});

afterEach(() => {
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  } else {
    Reflect.deleteProperty(window, 'matchMedia');
  }
});

describe('RepeatableGroup — rendu (§14.2, point 13)', () => {
  test('rend le compte et l’invite sans tableau d’en-têtes vide', () => {
    renderGroup({ rows: [] });

    expect(screen.getByText('0 occurrence(s)')).toBeInTheDocument();
    expect(screen.getByText('Aucune occurrence saisie.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter une occurrence' })).toBeEnabled();
  });

  test('rend les valeurs d’une occurrence par leurs libellés lisibles', () => {
    const fields = [
      field({
        fieldKey: 'morphologie', label: 'Morphologie', type: 'select', displayOrder: 0,
        allowedValues: ['a3'],
        allowedOptions: [{ value_key: 'a3', label: 'A3', is_active: true }],
      }),
      field({ fieldKey: 'diagnostic', label: 'Diagnostic', type: 'terminology', displayOrder: 1 }),
      field({ fieldKey: 'imagerie', label: 'Imagerie', type: 'text', displayOrder: 2 }),
    ];
    renderGroup({
      fields,
      rows: [occurrence('occ-1', {
        morphologie: 'a3',
        diagnostic: { code: '1F40', label: 'Paludisme' },
        imagerie: makeMissing('non_fait'),
      })],
      canWrite: false,
    });

    const table = screen.getByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getByText('A3')).toBeInTheDocument();
    expect(within(table).getByText('Paludisme')).toBeInTheDocument();
    expect(within(table).getByText('Non fait')).toBeInTheDocument();
    expect(within(table).queryByText('[object Object]')).not.toBeInTheDocument();
    expect(within(table).queryByText('1F40')).not.toBeInTheDocument();
  });

  test('rend les cinquante occurrences et désactive l’ajout à la borne', () => {
    const rows = Array.from({ length: 50 }, (_, index) => occurrence(
      'occ-' + (index + 1), { niveau: 'N' + (index + 1) }, '2026-09-18T10:00:00.000Z',
    ));
    renderGroup({ rows });

    const table = screen.getByRole('table', { name: 'Occurrences de Lésions' });
    expect(screen.getByText('50 occurrence(s)')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(51);
    expect(screen.getByRole('button', { name: 'Modifier l’occurrence 50 de Lésions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter une occurrence' })).toBeDisabled();
    expect(screen.getByText(/Nombre maximal d’occurrences atteint.*\(50\)/)).toBeInTheDocument();
  });

  test('filtre les lignes sur la version historique et peut interdire les nouvelles occurrences', () => {
    const oldRow = { ...occurrence('occ-v1', { niveau: 'C5' }), templateVersionId: 'version-1' };
    const currentRow = { ...occurrence('occ-v2', { niveau: 'T3' }), templateVersionId: 'version-2' };
    renderGroup({
      rows: [oldRow, currentRow],
      occurrenceTemplateVersionId: 'version-1',
      canCreate: false,
    });

    const table = screen.getByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('C5')).toBeInTheDocument();
    expect(within(table).queryByText('T3')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une occurrence' })).not.toBeInTheDocument();
  });

  test('applique la borne globale même si les lignes de cette version sont sous la limite', () => {
    renderGroup({ rows: [occurrence('occ-v2')], totalOccurrenceCount: 50 });

    expect(screen.getByText('1 occurrence(s)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter une occurrence' })).toBeDisabled();
    expect(screen.getByText(/Nombre maximal d’occurrences atteint.*\(50\)/)).toBeInTheDocument();
  });

  test('garde les en-têtes et annonce le chargement sans offrir d’ajout', () => {
    renderGroup({ rows: null });

    const table = screen.getByRole('table', { name: 'Occurrences de Lésions' });
    expect(within(table).getByRole('columnheader', { name: 'Niveau' })).toBeInTheDocument();
    expect(within(table).getByRole('status')).toHaveTextContent('Chargement des occurrences');
    expect(screen.queryByRole('button', { name: 'Ajouter une occurrence' })).not.toBeInTheDocument();
  });
});

describe('RepeatableGroup — bascule tableau/carte (§14.2, point 14)', () => {
  test.each([6, 7])('affiche %i colonnes selon le seuil de six', (columnCount) => {
    mockMatchMedia(false);
    renderGroup({ fields: columns(columnCount), rows: [occurrence('occ-1', {})], canWrite: false });

    if (columnCount === 6) {
      expect(screen.getByRole('table', { name: 'Occurrences de Lésions' })).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole('list')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    }
  });

  test('passe aux cartes sous 768 px et revient au tableau à 768 px', async () => {
    const viewport = mockMatchMedia(true);
    renderGroup({ fields: columns(6), rows: [occurrence('occ-1', {})], canWrite: false });

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    act(() => viewport.setMatches(false));
    await waitFor(() => expect(screen.getByRole('table', { name: 'Occurrences de Lésions' })).toBeInTheDocument());
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('RepeatableGroup — actions et permissions', () => {
  test.each([
    ['lecture seule', { canWrite: false }, null],
    ['hors ligne', { online: false }, 'Les blocs répétables ne sont pas disponibles hors ligne'],
    ['fiche non enregistrée', { patientId: null }, 'Ce bloc devient saisissable une fois la fiche enregistrée'],
  ] as const)('n’offre aucune écriture en état %s', (_name, state, notice) => {
    renderGroup({ rows: [occurrence('occ-1')], ...state });

    expect(screen.getByRole('table', { name: 'Occurrences de Lésions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Modifier l’occurrence/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Supprimer l’occurrence/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une occurrence' })).not.toBeInTheDocument();
    if (notice) expect(screen.getByText(new RegExp(notice))).toBeInTheDocument();
  });

  test('garde les actions absentes sur une occurrence déjà curée', () => {
    renderGroup({ rows: [occurrence('occ-curated', { niveau: 'C5' }, undefined, 'curated')] });

    expect(screen.getByRole('table', { name: 'Occurrences de Lésions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier l’occurrence 1 de Lésions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Supprimer l’occurrence 1 de Lésions' })).not.toBeInTheDocument();
  });

  test('crée par le moteur de champs avec défauts, règle du bloc et valeur manquante codifiée', async () => {
    const createEncounter = vi.fn<PatientRepository['createEncounter']>(async () => ({ id: 'occ-new' }));
    const onChanged = vi.fn();
    const fields = [
      field({ fieldKey: 'niveau', label: 'Niveau', type: 'text', required: true, defaultValue: 'C5' }),
      field({
        fieldKey: 'cause', label: 'Cause', type: 'text', required: true,
        allowMissingCodes: true, missingReasons: ['non_fait'],
      }),
      field({ fieldKey: 'type', label: 'Type', type: 'text' }),
      field({ fieldKey: 'precision', label: 'Précision', type: 'text' }),
    ];
    const rules: ValidationRule[] = [{
      id: 'autre-exige-precision',
      rule: { if: { field: 'type', operator: 'equals', value: 'autre' }, then: { field: 'precision', operator: 'required' } },
      message: 'Précisez le type indiqué.',
      severity: 'block',
    }];
    const patients = makePatients({ createEncounter });
    renderGroup({ fields, rows: [], rules, patients, onChanged });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Ajouter une occurrence' }));
    expect(screen.getByRole('textbox', { name: 'Niveau' })).toHaveValue('C5');
    await user.type(screen.getByRole('textbox', { name: 'Type' }), 'autre');
    await user.selectOptions(screen.getByLabelText('Cause — valeur manquante'), 'non_fait');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’occurrence' }));

    expect(await screen.findByText('Précisez le type indiqué.')).toBeInTheDocument();
    expect(createEncounter).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'Précision' }), 'précision saisie');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’occurrence' }));

    await waitFor(() => expect(createEncounter).toHaveBeenCalledWith('patient-1', {
      encounterType: 'autre',
      encounterDate: null,
      validationStatus: 'complete',
      ageUnit: 'years',
      data: { niveau: 'C5', cause: { __missing__: 'non_fait' }, type: 'autre', precision: 'précision saisie' },
      groupSectionKey: 'lesions',
    }));
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Occurrence ajoutée. 1 occurrence(s) dans ce bloc.');
  });

  test('conserve le brouillon conflictuel de la ligne 1 pendant la correction de la ligne 2, puis recharge sur confirmation', async () => {
    const row1 = occurrence('occ-1', { niveau: 'C5' }, '2026-09-18T10:01:00.000Z');
    const row2 = occurrence('occ-2', { niveau: 'T3' }, '2026-09-18T10:02:00.000Z');
    const freshRow1 = occurrence('occ-1', { niveau: 'L1' }, '2026-09-19T08:30:00.000Z');
    const updateEncounter = vi.fn<PatientRepository['updateEncounter']>(async (id) => {
      if (id === 'occ-1') throw new Error('CONFLIT_VERSION');
      return { id };
    });
    const getEncounter = vi.fn<PatientRepository['getEncounter']>(async () => freshRow1);
    const patients = makePatients({ updateEncounter, getEncounter });
    renderGroup({ rows: [row1, row2], patients });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Modifier l’occurrence 1 de Lésions' }));
    await user.clear(screen.getByRole('textbox', { name: 'Niveau' }));
    await user.type(screen.getByRole('textbox', { name: 'Niveau' }), 'Brouillon local ligne 1');
    await user.type(screen.getByRole('textbox', { name: /Motif de la correction/ }), 'Correction concurrente ligne 1');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’occurrence' }));

    expect(await screen.findByText(/Cette occurrence a été modifiée entre-temps/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Niveau' })).toHaveValue('Brouillon local ligne 1');
    expect(screen.getByRole('button', { name: 'Enregistrer l’occurrence' })).toBeDisabled();
    expect(updateEncounter).toHaveBeenCalledWith(
      'occ-1', { niveau: 'Brouillon local ligne 1' }, 'complete', 'Correction concurrente ligne 1', row1.updatedAt,
    );

    await user.click(screen.getByRole('button', { name: 'Modifier l’occurrence 2 de Lésions' }));
    expect(screen.getByRole('textbox', { name: 'Niveau' })).toHaveValue('T3');
    await user.clear(screen.getByRole('textbox', { name: 'Niveau' }));
    await user.type(screen.getByRole('textbox', { name: 'Niveau' }), 'T4');
    await user.type(screen.getByRole('textbox', { name: /Motif de la correction/ }), 'Correction ligne 2');
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’occurrence' }));

    await waitFor(() => expect(updateEncounter).toHaveBeenCalledWith(
      'occ-2', { niveau: 'T4' }, 'complete', 'Correction ligne 2', row2.updatedAt,
    ));
    await user.click(screen.getByRole('button', { name: 'Modifier l’occurrence 1 de Lésions' }));
    expect(screen.getByRole('textbox', { name: 'Niveau' })).toHaveValue('Brouillon local ligne 1');
    expect(screen.getByRole('textbox', { name: /Motif de la correction/ })).toHaveValue('Correction concurrente ligne 1');

    await user.click(screen.getByRole('button', { name: 'Recharger les occurrences' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Les saisies non enregistrées de cette occurrence seront abandonnées. Les autres occurrences sont conservées.')).toBeInTheDocument();
    expect(getEncounter).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.getByRole('textbox', { name: 'Niveau' })).toHaveValue('Brouillon local ligne 1');

    await user.click(screen.getByRole('button', { name: 'Recharger les occurrences' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Quitter la saisie' }));
    await waitFor(() => expect(getEncounter).toHaveBeenCalledWith('occ-1'));
    expect(screen.getByRole('textbox', { name: 'Niveau' })).toHaveValue('L1');
    expect(screen.getByRole('textbox', { name: /Motif de la correction/ })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Enregistrer l’occurrence' })).toBeEnabled();
  });

  test('la suppression passe par un motif et annonce le compte après retrait', async () => {
    const row1 = occurrence('occ-1', { niveau: 'C5' });
    const row2 = occurrence('occ-2', { niveau: 'T3' });
    const softDeleteEncounter = vi.fn<PatientRepository['softDeleteEncounter']>(async () => {});
    const onChanged = vi.fn();
    const options: GroupOptions = {
      rows: [row1, row2],
      patients: makePatients({ softDeleteEncounter }),
      onChanged,
    };
    const { rerender } = renderGroup(options);
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Modifier l’occurrence 2 de Lésions' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Supprimer l’occurrence 2 de Lésions' }));
    await user.type(screen.getByLabelText('Motif de la suppression'), 'doublon');
    await user.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(softDeleteEncounter).toHaveBeenCalledWith('occ-2', 'doublon'));
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Occurrence supprimée. 1 occurrence(s) dans ce bloc.');

    rerender(groupUi({ ...options, rows: [row1] }));
    expect(screen.getByText('1 occurrence(s)')).toBeInTheDocument();
    expect(screen.queryByText('T3')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier l’occurrence 2 de Lésions' })).not.toBeInTheDocument();
  });
});
