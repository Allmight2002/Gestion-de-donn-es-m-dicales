// @vitest-environment jsdom
// Test de rendu de l'ecran d'import (audit §6, P2) avec repos INJECTES : upload CSV reel ->
// correspondance auto par index -> apercu (dry-run) -> import. Le parsing (xlsx) et la
// construction des lignes sont les vrais (pas de mock), seuls les repos sont injectes.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ImportData } from './ImportData';
import type { BaseRepository } from '../../data/bases';
import type { TemplateRepository } from '../../data/templates';
import type { PatientRepository, ImportOptions } from '../../data/patients';
import type { NewField, TemplateField } from '../../data/types';
import type { ImportRow, ImportReport } from '../../domain/import';

const field = (fieldKey: string, label: string, scope: TemplateField['scope'], type: TemplateField['type'] = 'text'): TemplateField => ({
  id: fieldKey, fieldKey, label, scope, section: 'clinique', type, unit: null, allowedValues: null,
  required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
});

const FIELDS: TemplateField[] = [
  field('sexe', 'Sexe', 'patient'),
  field('diagnosis', 'Diagnostic', 'encounter'),
  field('glasgow_score', 'Score de Glasgow', 'encounter', 'integer'),
];

function renderImport(
  importRecords: PatientRepository['importRecords'],
  templatesRepo?: TemplateRepository,
  patientOverrides: Partial<PatientRepository> = {},
) {
  const getVersion = vi.fn(async () => ({ version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' as const }, fields: FIELDS, rules: [] }));
  const bases = {
    async getBase() {
      return { base: { id: 'b1', name: 'B', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' }, role: 'owner', permissions: {}, templateName: 'N', versionNumber: 1 };
    },
  } as unknown as BaseRepository;
  const templates = templatesRepo ?? ({ getVersion } as unknown as TemplateRepository);
  const patients = {
    importRecords,
    detectImportDuplicates: async () => [],
    ...patientOverrides,
  } as unknown as PatientRepository;
  const utils = render(
    <I18nProvider>
      <RepositoryProvider bases={bases} templates={templates} patients={patients}>
        <MemoryRouter initialEntries={['/bases/b1/import']}>
          <Routes>
            <Route path="/bases/:id/import" element={<ImportData />} />
            <Route path="/bases/:id" element={<div>BASE HOME</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
  return { ...utils, getVersion };
}

const CSV = 'Code patient,Sexe,Diagnostic,Score de Glasgow,Date\nP1,M,TC,12,2024-01-05\n';
const largeCsv = (count = 301) => `Code patient,Sexe\n${Array.from(
  { length: count }, (_, i) => `P${i + 1},${i % 2 ? 'F' : 'M'}`,
).join('\n')}\n`;
const crossChunkDuplicateCsv = () => `Code patient,Diagnostic,Date\n${Array.from(
  { length: 301 },
  (_, i) => (i === 300 ? 'P1,D0,2024-01-01' : `P${i + 1},D${i},2024-01-${String((i % 28) + 1).padStart(2, '0')}`),
).join('\n')}\n`;

// jsdom : File.arrayBuffer() n'est pas garanti -> on le fournit explicitement (octets reels).
function csvFile(content: string, name = 'data.csv') {
  const f = new File([content], name, { type: 'text/csv' });
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new TextEncoder().encode(content).buffer });
  return f;
}
const upload = (content = CSV) =>
  fireEvent.change(screen.getByLabelText(/fichier/i), { target: { files: [csvFile(content)] } });

describe('ImportData (ecran d import)', () => {
  test('upload CSV -> correspondance auto -> apercu (dry-run) -> import (commit)', async () => {
    const report: ImportReport = { dry_run: true, status: 'draft', patients_new: 1, patients_updated: 0, encounters: 1, error_count: 0, errors: [] };
    const importRecords = vi.fn(async (_b: string, _rows: ImportRow[], _o: ImportOptions) => report);
    const { getVersion } = renderImport(importRecords);
    await waitFor(() => expect(getVersion).toHaveBeenCalled()); // champs du gabarit charges

    upload();
    // La correspondance des colonnes apparait une fois le fichier parse.
    expect(await screen.findByText(/correspondance des colonnes/i)).toBeInTheDocument();
    expect(screen.getByText(/1 ligne/i)).toBeInTheDocument();
    // Attendre que la correspondance soit stabilisee (colonne "Sexe" -> patient:sexe).
    await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('patient:sexe'));

    // Apercu : importRecords appele en DRY-RUN (donc le code patient a bien ete reconnu).
    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
    await waitFor(() => expect(importRecords).toHaveBeenCalledTimes(1));
    expect(importRecords.mock.calls[0][2]).toMatchObject({ dryRun: true, status: 'draft', conflict: 'fill' });
    // Les lignes structurees : 1 patient P1 + 1 rencontre, AVEC la provenance source
    // (audit v20 §7.7 : numero de ligne + empreinte normalisee pour la reprise technique).
    const sent = importRecords.mock.calls[0][1];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      patient_code: 'P1', identity: null, patient_data: { sexe: 'M' },
      encounter: { encounter_type: 'consultation', encounter_date: '2024-01-05', data: { diagnosis: 'TC', glasgow_score: 12 } },
      source_row_number: 1,
      normalized_row_hash: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    expect(await screen.findByText(/encore été écrit/i)).toBeInTheDocument(); // rapport d'apercu
    expect(screen.getByText(/nouveaux patients/i)).toBeInTheDocument();

    // Import : importRecords appele en commit (dryRun=false) -> message de fin.
    await userEvent.click(screen.getByRole('button', { name: 'Importer' }));
    await waitFor(() => expect(importRecords).toHaveBeenCalledTimes(2));
    expect(importRecords.mock.calls[1][2]).toMatchObject({ dryRun: false });
    expect(await screen.findByText(/import terminé/i)).toBeInTheDocument();
  });

  test('V2 : colonne non reconnue -> creation de la variable en ligne -> colonne mappee et importee', async () => {
    const report: ImportReport = { dry_run: true, status: 'draft', patients_new: 2, patients_updated: 0, encounters: 2, error_count: 0, errors: [] };
    const importRecords = vi.fn(async (_b: string, _rows: ImportRow[], _o: ImportOptions) => report);
    // Repo gabarits AVEC ETAT : addField ajoute vraiment le champ -> getVersion le restitue ensuite.
    let fields = [...FIELDS];
    const addField = vi.fn(async (_v: string, f: NewField) => {
      const nf: TemplateField = {
        id: f.fieldKey, fieldKey: f.fieldKey, label: f.label, scope: f.scope, section: f.section, type: f.type,
        unit: null, allowedValues: f.allowedValues ?? null, required: f.required, minValue: null, maxValue: null,
        allowMissingCodes: false, displayOrder: fields.length,
      };
      fields = [...fields, nf];
      return nf;
    });
    const templates = {
      getVersion: async () => ({ version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' as const }, fields: [...fields], rules: [] }),
      addField,
    } as unknown as TemplateRepository;
    renderImport(importRecords, templates);

    upload('Code patient,Sexe,Poids (kg)\nP1,M,72.5\nP2,F,81\n');
    expect(await screen.findByText(/correspondance des colonnes/i)).toBeInTheDocument();

    // « Poids (kg) » est inconnue du jeu de variables -> le proprietaire peut la creer sur place.
    await userEvent.click(await screen.findByRole('button', { name: 'Créer la variable' }));
    // Mini-formulaire pre-rempli : libelle = en-tete, type INFERE depuis les valeurs (72.5, 81 -> number).
    expect(await screen.findByText(/Nouvelle variable pour la colonne/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('number')).toBeInTheDocument();
    // Pendant l'edition, le declencheur est masque : le seul bouton restant est celui du formulaire.
    await userEvent.click(screen.getByRole('button', { name: 'Créer la variable' }));
    await waitFor(() => expect(addField).toHaveBeenCalledTimes(1));
    expect(addField.mock.calls[0][1]).toMatchObject({ fieldKey: 'poids_kg', label: 'Poids (kg)', type: 'number', scope: 'patient', required: false });

    // La colonne n'est plus une impasse : elle est mappee sur la nouvelle variable.
    await waitFor(() => expect((screen.getAllByRole('combobox')[2] as HTMLSelectElement).value).toBe('patient:poids_kg'));

    // Et l'import transporte bien la valeur (coercition number).
    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
    await waitFor(() => expect(importRecords).toHaveBeenCalledTimes(1));
    const sent = importRecords.mock.calls[0][1];
    expect(sent[0].patient_data).toEqual({ sexe: 'M', poids_kg: 72.5 });
  });

  test('en-tete sans code patient : l apercu est impossible', async () => {
    const importRecords = vi.fn(async (_b: string, _rows: ImportRow[], _o: ImportOptions): Promise<ImportReport> => ({ dry_run: true, status: 'draft', patients_new: 0, patients_updated: 0, encounters: 0, error_count: 0, errors: [] }));
    const { getVersion } = renderImport(importRecords);
    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    // CSV sans colonne "Code patient" -> pas de cible patient_code -> bouton Apercu desactive.
    upload('Sexe,Diagnostic\nM,TC\n');
    expect(await screen.findByText(/associez une colonne/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aperçu' })).toBeDisabled();
    expect(importRecords).not.toHaveBeenCalled();
  });

  test('apercu de 301 lignes : detecte un doublon exact situe dans deux chunks differents', async () => {
    const importRecords = vi.fn(async (_b: string, chunk: ImportRow[], opts: ImportOptions): Promise<ImportReport> => ({
      dry_run: opts.dryRun,
      status: 'draft',
      patients_new: chunk.length,
      patients_updated: 0,
      encounters: chunk.length,
      error_count: 0,
      errors: [],
    }));
    const { getVersion } = renderImport(importRecords);
    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    upload(crossChunkDuplicateCsv());
    await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('encounter:diagnosis'));

    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }));

    await waitFor(() => expect(importRecords).toHaveBeenCalledTimes(2));
    expect(importRecords.mock.calls.map((call) => call[1].length)).toEqual([300, 1]);
    expect(await screen.findByText(/premiere ligne 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Ligne 301/i)).toHaveTextContent(/double dans le fichier/i);
  });

  test('double clic sur Importer : un seul lot est ouvert et complete', async () => {
    const succeeded = new Set<number>();
    const importRecords = vi.fn(async (_b: string, chunk: ImportRow[], opts: ImportOptions): Promise<ImportReport> => {
      if (!opts.dryRun) chunk.forEach((row) => succeeded.add(row.source_row_number!));
      return {
        dry_run: opts.dryRun, status: 'draft', patients_new: chunk.length,
        patients_updated: 0, encounters: 0, error_count: 0, errors: [],
        newly_imported: opts.dryRun ? undefined : chunk.length,
        already_processed: 0, rejected: 0,
      };
    });
    const beginImportBatch = vi.fn(async () => 'batch-double-click');
    const getImportBatchState = vi.fn(async () => ({
      batch_id: 'batch-double-click', status: 'processing', expected_rows: 301,
      row_count: succeeded.size, error_count: 0,
      succeeded_source_rows: [...succeeded], rejected_source_rows: [],
    }));
    const completeImportBatch = vi.fn(async () => undefined);
    const { getVersion } = renderImport(importRecords, undefined, {
      beginImportBatch, getImportBatchState, completeImportBatch,
    });
    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    upload(largeCsv());
    await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('patient:sexe'));
    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
    await screen.findByText(/encore été écrit/i);

    const commit = screen.getByRole('button', { name: 'Importer' });
    fireEvent.click(commit);
    fireEvent.click(commit);
    await waitFor(() => expect(completeImportBatch).toHaveBeenCalledTimes(1));
    expect(beginImportBatch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/import terminé/i)).toBeInTheDocument();
  });

  test('rafraichissement : relit le serveur, saute les succes et fonctionne sans localStorage', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
      if (String(key).startsWith('import-resume:')) throw new Error('localStorage import interdit');
    });
    const succeeded = new Set<number>();
    let failLastChunkOnce = true;
    let phase = 1;
    const retryChunkSizes: number[] = [];
    const importRecords = vi.fn(async (_b: string, chunk: ImportRow[], opts: ImportOptions): Promise<ImportReport> => {
      if (opts.dryRun) {
        return { dry_run: true, status: 'draft', patients_new: chunk.length, patients_updated: 0, encounters: 0, error_count: 0, errors: [] };
      }
      if (phase === 2) retryChunkSizes.push(chunk.length);
      if (chunk.length === 1 && failLastChunkOnce) {
        failLastChunkOnce = false;
        throw new Error('réponse réseau perdue');
      }
      chunk.forEach((row) => succeeded.add(row.source_row_number!));
      return {
        dry_run: false, status: 'draft', patients_new: chunk.length,
        patients_updated: 0, encounters: 0, error_count: 0, errors: [],
        newly_imported: chunk.length, already_processed: 0, rejected: 0,
      };
    });
    const beginImportBatch = vi.fn(async () => 'batch-refresh');
    const getImportBatchState = vi.fn(async () => ({
      batch_id: 'batch-refresh', status: 'processing', expected_rows: 301,
      row_count: succeeded.size, error_count: 0,
      succeeded_source_rows: [...succeeded], rejected_source_rows: [],
    }));
    const completeImportBatch = vi.fn(async () => undefined);
    const repos = { beginImportBatch, getImportBatchState, completeImportBatch };

    const first = renderImport(importRecords, undefined, repos);
    await waitFor(() => expect(first.getVersion).toHaveBeenCalled());
    upload(largeCsv());
    await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('patient:sexe'));
    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Importer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/réponse réseau perdue/i);
    expect(succeeded.size).toBe(300);
    first.unmount();

    phase = 2;
    const refreshed = renderImport(importRecords, undefined, repos);
    await waitFor(() => expect(refreshed.getVersion).toHaveBeenCalled());
    upload(largeCsv());
    await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('patient:sexe'));
    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Importer' }));
    await waitFor(() => expect(completeImportBatch).toHaveBeenCalledTimes(1));

    expect(retryChunkSizes).toEqual([1]);
    expect(screen.getByText(/lignes déjà traitées \(reprise\)/i).parentElement).toHaveTextContent('300');
    expect(screen.getByText(/état serveur/i)).toHaveTextContent(/301 lignes traitées, dont 0 rejetées/i);
    expect(storage.mock.calls.some(([key]) => String(key).startsWith('import-resume:'))).toBe(false);
    storage.mockRestore();
  });

  test('un lot interrompu peut etre annule seulement apres la fin de l ecriture', async () => {
    let cancelled = false;
    const importRecords = vi.fn(async (_b: string, chunk: ImportRow[], opts: ImportOptions): Promise<ImportReport> => {
      if (!opts.dryRun) throw new Error('écriture interrompue');
      return { dry_run: true, status: 'draft', patients_new: chunk.length, patients_updated: 0, encounters: 0, error_count: 0, errors: [] };
    });
    const cancelImportBatch = vi.fn(async () => { cancelled = true; });
    const getImportBatchState = vi.fn(async () => ({
      batch_id: 'batch-cancel', status: cancelled ? 'cancelled' : 'processing', expected_rows: 301,
      row_count: 0, error_count: 0, succeeded_source_rows: [], rejected_source_rows: [],
    }));
    const { getVersion } = renderImport(importRecords, undefined, {
      beginImportBatch: async () => 'batch-cancel',
      getImportBatchState,
      completeImportBatch: async () => undefined,
      cancelImportBatch,
    });
    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    upload(largeCsv());
    await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('patient:sexe'));
    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Importer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/écriture interrompue/i);

    const cancel = screen.getByRole('button', { name: 'Annuler ce lot' });
    expect(cancel).toBeEnabled();
    await userEvent.click(cancel);
    await waitFor(() => expect(cancelImportBatch).toHaveBeenCalledTimes(1));
    expect(getImportBatchState).toHaveBeenLastCalledWith('batch-cancel');
    expect(screen.queryByRole('button', { name: 'Annuler ce lot' })).not.toBeInTheDocument();
  });

  test('un lot historique ambigu expose son identifiant et l action d annulation sans rejouer de chunk', async () => {
    const importRecords = vi.fn(async (_b: string, chunk: ImportRow[], opts: ImportOptions): Promise<ImportReport> => ({
      dry_run: opts.dryRun, status: 'draft', patients_new: chunk.length,
      patients_updated: 0, encounters: 0, error_count: 0, errors: [],
    }));
    const completeImportBatch = vi.fn(async () => undefined);
    const { getVersion } = renderImport(importRecords, undefined, {
      beginImportBatch: async () => 'batch-historique',
      getImportBatchState: async () => ({
        batch_id: 'batch-historique', status: 'processing', resume_state: 'historical_unsafe',
        expected_rows: 301, row_count: 120, error_count: 0,
        succeeded_source_rows: [], rejected_source_rows: [],
      }),
      completeImportBatch,
      cancelImportBatch: async () => undefined,
    });
    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    upload(largeCsv());
    await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('patient:sexe'));
    await userEvent.click(screen.getByRole('button', { name: /Aper/ }));
    const previewCallCount = importRecords.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Importer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ancien lot|annulez/i);
    expect(screen.getByRole('button', { name: /Annuler ce lot/ })).toBeEnabled();
    expect(importRecords).toHaveBeenCalledTimes(previewCallCount); // aucun chunk de commit
    expect(completeImportBatch).not.toHaveBeenCalled();
  });

  // L24 : l'import ne resout AUCUN champ `terminology` (spec §9). L'ecran doit le DIRE — refuser
  // la cible et nommer les colonnes ecartees — plutot que laisser le serveur echouer en fin
  // d'import sur une chaine la ou il attend un couple {code, libelle}.
  test('cible de terminologie : jamais proposee, refusee a la main, et citee dans le rapport', async () => {
    const report: ImportReport = { dry_run: true, status: 'draft', patients_new: 1, patients_updated: 0, encounters: 1, error_count: 0, errors: [] };
    const importRecords = vi.fn(async (_b: string, _rows: ImportRow[], _o: ImportOptions) => report);
    const withTerminology: TemplateField[] = [
      ...FIELDS,
      { ...field('diagnostics', 'Diagnostics', 'encounter', 'terminology'), isMultiple: true },
      field('diagnostic_principal', 'Diagnostic principal', 'patient', 'terminology'),
    ];
    const templates = {
      getVersion: async () => ({ version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' as const }, fields: withTerminology, rules: [] }),
    } as unknown as TemplateRepository;
    renderImport(importRecords, templates);

    upload('Code patient,Sexe,Diagnostics,Diagnostic principal,Commentaire,Date\nP1,M,Cholera; Paludisme,Cholera,RAS,2024-01-05\n');
    expect(await screen.findByText(/correspondance des colonnes/i)).toBeInTheDocument();
    await waitFor(() => expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('patient:sexe'));

    // 1. Aucune des deux colonnes de diagnostic n'est proposee — a valeur multiple comme unique.
    expect((screen.getAllByRole('combobox')[2] as HTMLSelectElement).value).toBe('ignore');
    expect((screen.getAllByRole('combobox')[3] as HTMLSelectElement).value).toBe('ignore');
    // 2. L'etape de correspondance dit lesquelles, et pourquoi, AVANT tout aperçu.
    expect(screen.getByText(/ne peut pas encore traiter/i)).toBeInTheDocument();
    expect(screen.getByText(/« Diagnostics » → variable « Diagnostics »/)).toBeInTheDocument();
    expect(screen.getByText(/« Diagnostic principal » → variable « Diagnostic principal »/)).toBeInTheDocument();
    // La variable existe deja : on n'invite pas a la creer une seconde fois. Seule « Commentaire »,
    // inconnue du gabarit, garde ce bouton.
    expect(screen.getAllByRole('button', { name: 'Créer la variable' })).toHaveLength(1);

    // 3. Le choix manuel est REFUSE — et refuser, c'est ne rien changer : « Sexe » reste mappee.
    const sexe = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    expect([...sexe.options].some((option) => option.value === 'encounter:diagnostics')).toBe(true);
    await userEvent.selectOptions(sexe, 'encounter:diagnostics');
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThan(0));
    expect(sexe.value).toBe('patient:sexe');
    expect(screen.getAllByRole('status')[0].textContent).toMatch(/« Diagnostics ».*« Sexe »/s);

    // 4. Une colonne quelconque tentee sur cette cible reste ignoree, sans perdre ses options.
    const commentaire = screen.getAllByRole('combobox')[4] as HTMLSelectElement;
    await userEvent.selectOptions(commentaire, 'patient:diagnostic_principal');
    await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(2));
    expect(commentaire.value).toBe('ignore');
    expect(screen.getAllByRole('button', { name: 'Créer la variable' })).toHaveLength(1);

    // 5. Le rapport nomme les trois colonnes ecartees pour ce motif — sans les fondre dans les
    //    colonnes ignorees ordinaires. « Sexe », qui a garde son mappage, n'en fait pas partie.
    await userEvent.click(screen.getByRole('button', { name: 'Aperçu' }));
    await waitFor(() => expect(importRecords).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^3 colonne\(s\) ignorée\(s\)/)).toBeInTheDocument();

    // 6. Et rien de tout cela n'est parti au serveur : ni diagnostic, ni cellule brute a sa place.
    const sent = importRecords.mock.calls[0][1];
    expect(sent[0].patient_data).toEqual({ sexe: 'M' });
    expect(sent[0].encounter?.data).toEqual({});
  });
});
