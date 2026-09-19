import { StrictMode, useCallback, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Encounter, NewEncounterInput, PatientRepository } from '../../src/data/patients';
import type { TemplateField, TemplateSection } from '../../src/data/types';
import { RepositoryProvider } from '../../src/data/RepositoryProvider';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { EncounterFields } from '../../src/screens/member/EncounterFields';
import { RepeatableGroup } from '../../src/screens/member/RepeatableGroup';
import '../../src/index.css';

const section: TemplateSection = {
  id: 'local-fixture-section',
  sectionKey: 'local_fixture_group',
  label: 'Groupe fictif',
  displayOrder: 0,
  isRepeatable: true,
};

const fields: TemplateField[] = [
  {
    id: 'fixture-reference', fieldKey: 'fixture_reference', label: 'Repère de démonstration',
    scope: 'encounter', section: section.sectionKey, type: 'text', unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
  },
  {
    id: 'fixture-measure', fieldKey: 'fixture_measure', label: 'Mesure d’essai — valeur fictive',
    scope: 'encounter', section: section.sectionKey, type: 'number', unit: 'unités fictives', allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 1,
  },
  {
    id: 'fixture-context', fieldKey: 'fixture_context', label: 'Contexte simulé',
    scope: 'encounter', section: section.sectionKey, type: 'text', unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 2,
  },
  {
    id: 'fixture-note', fieldKey: 'fixture_note', label: 'Note de fixture',
    scope: 'encounter', section: section.sectionKey, type: 'text', unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 3,
  },
  {
    id: 'fixture-origin', fieldKey: 'fixture_origin', label: 'Origine de démonstration',
    scope: 'encounter', section: section.sectionKey, type: 'text', unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 4,
  },
  {
    id: 'fixture-detail', fieldKey: 'fixture_detail', label: 'Texte long de contrôle',
    scope: 'encounter', section: section.sectionKey, type: 'text', unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 5,
  },
];

const longFixtureText = 'Texte de démonstration fictif avec plusieurs mots pour vérifier le retour à la ligne et le comportement de la mise en page sur un écran étroit. '.repeat(3);

const initialRows: Encounter[] = [{
  id: 'local-fixture-occurrence-001',
  encounterType: 'autre',
  encounterDate: null,
  validationStatus: 'draft',
  ageValue: null,
  ageUnit: null,
  data: {
    fixture_reference: 'Fixture initiale — A',
    fixture_measure: 12.5,
    fixture_context: 'Contexte entièrement fictif, créé pour cette vérification locale.',
    fixture_note: 'Aucune donnée réelle.',
    fixture_origin: 'Harness navigateur local',
    fixture_detail: longFixtureText,
  },
  updatedAt: '2026-09-19T00:00:00.000Z',
  groupSectionKey: section.sectionKey,
}];

function BrowserFixture() {
  const store = useRef<Encounter[]>(initialRows.map((row) => ({ ...row, data: { ...row.data } })));
  const nextId = useRef(2);
  const [rows, setRows] = useState<Encounter[]>(() => [...store.current]);

  const patients = useMemo(() => {
    const fixtureRepository = {
      createEncounter: async (_patientId: string, input: NewEncounterInput) => {
        const ordinal = nextId.current++;
        const row: Encounter = {
          id: `local-fixture-occurrence-${String(ordinal).padStart(3, '0')}`,
          encounterType: input.encounterType,
          encounterDate: input.encounterDate ?? null,
          validationStatus: input.validationStatus,
          ageValue: input.ageValue ?? null,
          ageUnit: input.ageUnit ?? null,
          data: { ...input.data },
          updatedAt: `2026-09-19T00:00:${String(ordinal).padStart(2, '0')}.000Z`,
          groupSectionKey: input.groupSectionKey ?? null,
        };
        store.current = [...store.current, row];
        return { id: row.id };
      },
      updateEncounter: async (id: string, data: Record<string, unknown>, status: string) => {
        store.current = store.current.map((row) => row.id === id
          ? { ...row, data: { ...data }, validationStatus: status, updatedAt: '2026-09-19T00:01:00.000Z' }
          : row);
        return { id };
      },
      softDeleteEncounter: async (id: string) => {
        store.current = store.current.filter((row) => row.id !== id);
      },
      listEncounters: async () => [...store.current],
      getEncounter: async (id: string) => store.current.find((row) => row.id === id) ?? null,
    } satisfies Pick<PatientRepository, 'createEncounter' | 'updateEncounter' | 'softDeleteEncounter' | 'listEncounters' | 'getEncounter'>;

    return fixtureRepository as PatientRepository;
  }, []);

  const reloadRows = useCallback(() => setRows([...store.current]), []);

  return (
    <I18nProvider>
      <RepositoryProvider patients={patients}>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <header className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide">Vérification locale L68</p>
            <h1 className="mt-1 text-xl font-semibold">Groupe répétable — fixture fictive</h1>
            <p className="mt-2 text-sm">
              Persistance simulée en mémoire, réinitialisée au rechargement. Aucune donnée clinique réelle,
              aucun service distant et aucune écriture Supabase ne sont utilisés.
            </p>
          </header>

          <section aria-label="Formulaire de démonstration" className="card min-w-0 p-4 sm:p-6">
            <EncounterFields
              fields={fields}
              sections={[section]}
              values={{}}
              onChange={() => undefined}
              onRemove={() => undefined}
              repeatableGroup={(group) => (
                <RepeatableGroup
                  section={group}
                  fields={fields}
                  patientId="local-fixture-patient"
                  occurrences={rows}
                  onChanged={reloadRows}
                  canWrite
                  online
                />
              )}
            />
          </section>
        </main>
      </RepositoryProvider>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserFixture />
  </StrictMode>,
);
