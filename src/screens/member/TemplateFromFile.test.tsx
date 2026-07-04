// @vitest-environment jsdom
// F1 : upload -> proposition de champs -> creation du gabarit (createPersonalTemplate + addField).
import { describe, expect, test, vi } from 'vitest';

// On mocke le parsing tableur (xlsx/Worker indisponibles en jsdom) : on se concentre sur le flux.
vi.mock('../../domain/spreadsheet', () => ({
  parseSpreadsheetOffThread: async () => ({ headers: ['Age', 'Sexe'], rows: [[42, 'M'], [55, 'F'], [30, 'M'], [31, 'F']] }),
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TemplateFromFile } from './TemplateFromFile';
import type { TemplateRepository } from '../../data/templates';
import type { NewField } from '../../data/types';

describe('TemplateFromFile (F1)', () => {
  test('un fichier propose des champs, puis « créer » construit le gabarit', async () => {
    const createPersonalTemplate = vi.fn(async () => ({ id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' as const }));
    const addField = vi.fn(async (_v: string, _f: NewField) => ({} as never));
    const templates = { createPersonalTemplate, addField } as unknown as TemplateRepository;

    render(
      <I18nProvider>
        <RepositoryProvider templates={templates}>
          <MemoryRouter initialEntries={['/templates/from-file']}>
            <Routes>
              <Route path="/templates/from-file" element={<TemplateFromFile />} />
              <Route path="/templates" element={<div>TEMPLATES</div>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    const file = new File(['Age,Sexe\n42,M'], 'cohorte.csv', { type: 'text/csv' });
    // jsdom n'implemente pas File.arrayBuffer ; le parsing est mocke, un buffer vide suffit.
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
    await userEvent.upload(screen.getByLabelText(/Fichier/), file);

    // La proposition apparait (2 colonnes) + le nom du gabarit est pre-rempli depuis le fichier.
    const createBtn = await screen.findByRole('button', { name: /Créer le gabarit/ });
    expect((screen.getByLabelText('Nom du gabarit') as HTMLInputElement).value).toBe('cohorte');

    await userEvent.click(createBtn);
    await waitFor(() => expect(createPersonalTemplate).toHaveBeenCalledWith('cohorte', null));
    expect(addField).toHaveBeenCalledTimes(2); // Age + Sexe
    expect(await screen.findByText('TEMPLATES')).toBeInTheDocument(); // redirection apres creation
  });
});
