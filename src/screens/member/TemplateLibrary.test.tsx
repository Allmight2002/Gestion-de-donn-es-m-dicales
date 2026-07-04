// @vitest-environment jsdom
// F3 : la bibliotheque liste des modeles ; « Utiliser » clone les champs dans un gabarit personnel.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TemplateLibrary } from './TemplateLibrary';
import { TEMPLATE_LIBRARY } from '../../domain/templateLibrary';
import type { TemplateRepository } from '../../data/templates';
import type { NewField } from '../../data/types';

describe('TemplateLibrary (F3)', () => {
  test('liste les modeles et « Utiliser » cree le gabarit + ses champs', async () => {
    const createPersonalTemplate = vi.fn(async () => ({ id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' as const }));
    const addField = vi.fn(async (_v: string, _f: NewField) => ({} as never));
    const templates = { createPersonalTemplate, addField } as unknown as TemplateRepository;

    render(
      <I18nProvider>
        <RepositoryProvider templates={templates}>
          <MemoryRouter initialEntries={['/templates/library']}>
            <Routes>
              <Route path="/templates/library" element={<TemplateLibrary />} />
              <Route path="/templates" element={<div>TEMPLATES</div>} />
            </Routes>
          </MemoryRouter>
        </RepositoryProvider>
      </I18nProvider>,
    );

    const first = TEMPLATE_LIBRARY[0];
    expect(await screen.findByText(first.name)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Utiliser ce modèle' })[0]);
    await waitFor(() => expect(createPersonalTemplate).toHaveBeenCalledWith(first.name, first.specialty));
    expect(addField).toHaveBeenCalledTimes(first.fields.length);
    expect(await screen.findByText('TEMPLATES')).toBeInTheDocument();
  });
});
