// @vitest-environment jsdom
// F1 : upload -> proposition de champs -> creation du gabarit (createPersonalTemplate + addField).
import { describe, expect, test, vi } from 'vitest';

// On mocke le parsing tableur (xlsx/Worker indisponibles en jsdom) : on se concentre sur le flux.
vi.mock('../../domain/spreadsheet', () => ({
  parseSpreadsheetOffThread: async () => ({ headers: ['Age', 'Sexe'], rows: [[42, 'M'], [55, 'F'], [30, 'M'], [31, 'F']] }),
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TemplateFromFile } from './TemplateFromFile';
import type { BaseRepository } from '../../data/bases';
import type { TemplateBundleInput, TemplateRepository } from '../../data/templates';

function renderScreen(templates: TemplateRepository, bases?: BaseRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider templates={templates} bases={bases}>
        <MemoryRouter initialEntries={['/templates/from-file']}>
          <Routes>
            <Route path="/templates/from-file" element={<TemplateFromFile />} />
            <Route path="/templates" element={<div>TEMPLATES</div>} />
            <Route path="/bases/:id/import" element={<div>IMPORT-ECRAN</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

async function uploadSheet() {
  const file = new File(['Age,Sexe\n42,M'], 'cohorte.csv', { type: 'text/csv' });
  // jsdom n'implemente pas File.arrayBuffer ; le parsing est mocke, un buffer vide suffit.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
  await userEvent.upload(screen.getByLabelText(/Fichier/), file);
}

describe('TemplateFromFile (F1)', () => {
  test('un fichier propose des champs, puis « créer » construit le jeu de variables', async () => {
    const createTemplateBundle = vi.fn(async (_input: TemplateBundleInput) => ({ templateId: 't1', versionId: 'v1', baseId: null }));
    const getVersion = vi.fn(async () => ({
      version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' as const },
      fields: [], rules: [], sections: [],
    }));
    renderScreen({ createTemplateBundle, getVersion } as unknown as TemplateRepository);

    await uploadSheet();

    // La proposition apparait (2 colonnes) + le nom du jeu est pre-rempli depuis le fichier.
    const createBtn = await screen.findByRole('button', { name: /Créer le jeu de variables/ });
    expect((screen.getByLabelText('Nom du jeu de variables') as HTMLInputElement).value).toBe('cohorte');

    await userEvent.click(createBtn);
    await waitFor(() => expect(createTemplateBundle).toHaveBeenCalledTimes(1));
    expect(createTemplateBundle.mock.calls[0][0]).toMatchObject({ name: 'cohorte', specialty: null, withBase: false });
    expect(createTemplateBundle.mock.calls[0][0].fields).toHaveLength(2);
    expect(await screen.findByRole('heading', { name: 'cohorte' })).toBeInTheDocument(); // ouverture directe de l’éditeur
  });

  test('V3 : « créer aussi une base » cree jeu + base et atterrit sur l ecran d import', async () => {
    const createTemplateBundle = vi.fn(async (_input: TemplateBundleInput) => ({ templateId: 't1', versionId: 'v1', baseId: 'bnew' }));
    renderScreen(
      { createTemplateBundle } as unknown as TemplateRepository,
    );

    await uploadSheet();
    await screen.findByRole('button', { name: /Créer le jeu de variables/ });

    // Cocher l'option : le nom de base est pre-rempli depuis le fichier, le bouton change.
    await userEvent.click(screen.getByLabelText(/Créer aussi une base/));
    expect((screen.getByLabelText('Nom de la base') as HTMLInputElement).value).toBe('cohorte');
    await userEvent.click(screen.getByRole('button', { name: 'Créer le jeu de variables + la base' }));

    // Une seule commande cree jeu, champs et base, puis redirection vers l'import.
    await waitFor(() => expect(createTemplateBundle).toHaveBeenCalledTimes(1));
    expect(createTemplateBundle.mock.calls[0][0]).toMatchObject({ name: 'cohorte', baseName: 'cohorte', withBase: true });
    expect(await screen.findByText('IMPORT-ECRAN')).toBeInTheDocument();
  });
});
