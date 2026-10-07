// @vitest-environment jsdom
//
// L74d — test 17 du §9.2 (docs/l74-contexte-patient-occurrences.md) : une règle EXISTANTE que
// D5 refuserait à l'écriture est signalée dans la liste des règles de la version, sans jamais
// bloquer l'édition de cette version. Données fictives de la fixture du registre.
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TemplateVersionEditor } from './TemplateVersionEditor';
import { createEditorRegistryRepository, editorRegistryVersion } from '../../test/fixtures/editorRegistry';

const panneau = () => within(document.getElementById('editor-panel-rules') as HTMLElement);

describe('Éditeur de version — règles lues sur deux fiches (L74d, D5)', () => {
  test('une règle dormante existante est signalée, et la version reste modifiable', async () => {
    const repo = createEditorRegistryRepository();
    const base = repo.getVersion;
    // P3 : obligation d'une variable de visite ordinaire pilotée par une variable permanente.
    // Acceptée avant D5, elle ne s'est jamais déclenchée.
    vi.spyOn(repo, 'getVersion').mockImplementation(async (id: string) => {
      const charge = await base.call(repo, id);
      return {
        ...charge,
        // En tete : la liste est paginee par groupes de conditions.
        rules: [{
          id: 'regle-dormante',
          rule: { if: { field: 'centre', operator: 'equals', value: 'centre_a' }, then: { field: 'motif_global', operator: 'required' } },
          message: null,
          severity: 'block' as const,
        }, ...charge.rules],
      };
    });
    render(
      <I18nProvider>
        <RepositoryProvider templates={repo}>
          <TemplateVersionEditor versionId={editorRegistryVersion.id} templateName="Registre multipathologies" onBack={() => {}} />
        </RepositoryProvider>
      </I18nProvider>,
    );
    await screen.findByRole('heading', { name: 'Registre multipathologies' });

    fireEvent.click(screen.getByRole('tab', { name: /^Règles/ }));
    const ligne = within(document.getElementById('rule-regle-dormante') as HTMLElement);
    expect(ligne.getByText(/Motif global est obligatoire/)).toBeInTheDocument();
    expect(ligne.getByText(/Obligation sans effet : la condition et la variable sont lues sur deux fiches différentes\./))
      .toBeInTheDocument();

    // Signaler n'est pas bloquer : la règle s'ouvre pour correction, et la version accepte
    // toujours une nouvelle règle.
    fireEvent.click(ligne.getByRole('button', { name: 'Modifier la règle' }));
    expect(panneau().getByRole('alert')).toHaveTextContent('Obligation sans effet');
    expect(screen.getByRole('button', { name: 'Ajouter une variable' })).toBeEnabled();
  });
});
