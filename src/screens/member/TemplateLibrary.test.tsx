// @vitest-environment jsdom
// F3 v2 : la bibliotheque liste les gabarits GLOBAUX (base) et les clone dans un gabarit personnel ;
// repli sur les modeles livres en dur si aucun modele global n'est publie.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TemplateLibrary } from './TemplateLibrary';
import { TEMPLATE_LIBRARY } from '../../domain/templateLibrary';
import type { TemplateBundleInput, TemplateRepository } from '../../data/templates';
import type { BaseRepository, PublishedTemplateOption } from '../../data/bases';

function renderLib(bases: BaseRepository, templates: TemplateRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider bases={bases} templates={templates}>
        <MemoryRouter initialEntries={['/templates/library']}>
          <Routes>
            <Route path="/templates/library" element={<TemplateLibrary />} />
            <Route path="/templates" element={<div>TEMPLATES</div>} />
          </Routes>
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('TemplateLibrary (F3 v2)', () => {
  test('liste les gabarits GLOBAUX (base) et « Utiliser » clone leurs champs dans un gabarit personnel', async () => {
    const models: PublishedTemplateOption[] = [
      { versionId: 'gv1', versionNumber: 1, templateId: 't1', name: 'Neuro global', specialty: 'Neurologie', scope: 'global' },
      { versionId: 'pv1', versionNumber: 1, templateId: 't2', name: 'Mon perso', specialty: null, scope: 'personal' }, // ignore (non global)
    ];
    const bases = { async listTemplateModels() { return models; } } as unknown as BaseRepository;
    const createTemplateBundle = vi.fn(async (_input: TemplateBundleInput) => ({ templateId: 'new', versionId: 'vnew', baseId: null }));
    const getVersion = vi.fn(async () => ({
      version: { id: 'vnew', templateId: 'new', versionNumber: 1, status: 'draft' as const },
      fields: [], rules: [], sections: [],
    }));
    const templates = { createTemplateBundle, getVersion } as unknown as TemplateRepository;

    renderLib(bases, templates);
    expect(await screen.findByText('Neuro global')).toBeInTheDocument();
    expect(screen.queryByText('Mon perso')).not.toBeInTheDocument(); // personnel exclu

    await userEvent.click(screen.getByRole('button', { name: 'Utiliser ce modèle' }));
    await waitFor(() => expect(createTemplateBundle).toHaveBeenCalledTimes(1));
    expect(createTemplateBundle).toHaveBeenCalledWith(expect.objectContaining({ name: 'Neuro global', specialty: 'Neurologie', sourceVersionId: 'gv1' }));
    expect(await screen.findByRole('heading', { name: 'Neuro global' })).toBeInTheDocument();
  });

  test('repli : aucun modele global -> affiche les modeles livres en dur', async () => {
    const bases = { async listTemplateModels() { return []; } } as unknown as BaseRepository;
    const createTemplateBundle = vi.fn(async (_input: TemplateBundleInput) => ({ templateId: 'new', versionId: 'vnew', baseId: null }));
    const templates = { createTemplateBundle } as unknown as TemplateRepository;

    renderLib(bases, templates);
    const first = TEMPLATE_LIBRARY[0];
    expect(await screen.findByText(first.name)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Utiliser ce modèle' })[0]);
    await waitFor(() => expect(createTemplateBundle).toHaveBeenCalledTimes(1));
    expect(createTemplateBundle.mock.calls[0][0].fields).toHaveLength(first.fields.length);
  });
});
