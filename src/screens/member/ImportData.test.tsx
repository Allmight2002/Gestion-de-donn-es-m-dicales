// @vitest-environment jsdom
// Test de rendu de l'ecran d'import (audit §6, P2) avec repos INJECTES : upload CSV reel ->
// correspondance auto par index -> apercu (dry-run) -> import. Le parsing (xlsx) et la
// construction des lignes sont les vrais (pas de mock), seuls les repos sont injectes.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

function renderImport(importRecords: PatientRepository['importRecords'], templatesRepo?: TemplateRepository) {
  const getVersion = vi.fn(async () => ({ version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' as const }, fields: FIELDS, rules: [] }));
  const bases = {
    async getBase() {
      return { base: { id: 'b1', name: 'B', specialty: null, ownerUserId: 'u', currentTemplateVersionId: 'v1' }, role: 'owner', permissions: {}, templateName: 'N', versionNumber: 1 };
    },
  } as unknown as BaseRepository;
  const templates = templatesRepo ?? ({ getVersion } as unknown as TemplateRepository);
  const patients = { importRecords } as unknown as PatientRepository;
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
    // Les lignes structurees : 1 patient P1 + 1 rencontre.
    const sent = importRecords.mock.calls[0][1];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      patient_code: 'P1', identity: null, patient_data: { sexe: 'M' },
      encounter: { encounter_type: 'consultation', encounter_date: '2024-01-05', data: { diagnosis: 'TC', glasgow_score: 12 } },
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
});
