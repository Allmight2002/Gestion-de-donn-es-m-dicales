// @vitest-environment jsdom
// Transfert d'un jeu de variables par fichier : export depuis « Mes jeux de variables »,
// import d'un fichier .meddata.json qui ouvre directement l'editeur du nouveau jeu.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
import { MyTemplates } from './MyTemplates';
import type { TemplateDefinitionImportInput, TemplateRepository } from '../../data/templates';
import {
  parseTemplateDefinition,
  templateDefinitionFileName,
  type TemplateDefinition,
} from '../../domain/templateDefinition';

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', email: null }, profile: { id: 'me', fullName: 'Doc', globalRole: 'medecin', language: 'fr' }, signOut: () => {} }),
}));

const definition: TemplateDefinition = {
  format: 'meddata.template-definition',
  formatVersion: 1,
  template: { name: 'Neurochirurgie', specialty: 'neurochirurgie', versionNumber: 2 },
  sections: [{ key: 'bloc', label: 'Bloc', parentKey: null, displayOrder: 0, isRepeatable: false }],
  commonGroups: [],
  fields: [{ fieldKey: 'geste', label: 'Geste', scope: 'patient', section: 'bloc', type: 'text' }],
  rules: [],
  diagnosisConfiguration: [],
  terminologyReleases: [],
};

function repo(over: Partial<TemplateRepository>): TemplateRepository {
  return {
    async listTemplates() {
      return [{ id: 'mine', name: 'Mon Neuro', specialty: null, ownerUserId: 'me', isGlobal: false,
        versions: [{ id: 'v1', templateId: 'mine', versionNumber: 1, status: 'draft' as const }] }];
    },
    async getVersion(versionId: string) {
      return { version: { id: versionId, templateId: 't', versionNumber: 1, status: 'draft' as const }, fields: [], rules: [], sections: [] };
    },
    ...over,
  } as unknown as TemplateRepository;
}

function renderMine(templates: TemplateRepository) {
  return render(
    <I18nProvider><ToastProvider><RepositoryProvider templates={templates}>
      <MemoryRouter><MyTemplates /></MemoryRouter>
    </RepositoryProvider></ToastProvider></I18nProvider>,
  );
}

// jsdom n'implemente pas `Blob.text()` (les navigateurs cibles, si) : lecture via FileReader.
if (typeof File.prototype.text !== 'function') {
  File.prototype.text = function text(this: File) {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(this);
    });
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('lecture d\'un fichier de definition', () => {
  test('accepte un export MedData et refuse le reste sans appeler le serveur', () => {
    expect(parseTemplateDefinition(JSON.stringify(definition))).toEqual({ ok: true, definition });
    expect(parseTemplateDefinition('pas du json')).toEqual({ ok: false, error: 'not_json' });
    expect(parseTemplateDefinition('[]')).toEqual({ ok: false, error: 'not_definition' });
    expect(parseTemplateDefinition(JSON.stringify({ ...definition, format: 'autre' }))).toEqual({ ok: false, error: 'not_definition' });
    expect(parseTemplateDefinition(JSON.stringify({ ...definition, formatVersion: 2 }))).toEqual({ ok: false, error: 'unsupported_version' });
    expect(parseTemplateDefinition(JSON.stringify({ ...definition, fields: {} }))).toEqual({ ok: false, error: 'not_definition' });
  });

  test('nom de fichier sans accent ni caractere special', () => {
    expect(templateDefinitionFileName('Registre Neurochirurgie — été', 3)).toBe('jeu-registre-neurochirurgie-ete-v3.meddata.json');
    expect(templateDefinitionFileName('!!!')).toBe('jeu-jeu-de-variables.meddata.json');
  });
});

describe('Mes jeux de variables — export / import par fichier', () => {
  test('exporte la version preferee dans un fichier .meddata.json', async () => {
    const user = userEvent.setup();
    const exportTemplateDefinition = vi.fn(async () => definition);
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderMine(repo({ exportTemplateDefinition, importTemplateDefinition: vi.fn() }));

    await user.click(await screen.findByRole('button', { name: /Actions.*Mon Neuro/ }));
    await user.click(screen.getByRole('button', { name: 'Exporter en fichier' }));

    await waitFor(() => expect(exportTemplateDefinition).toHaveBeenCalledWith('v1'));
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('jeu-mon-neuro-v1.meddata.json');
    expect(await screen.findByText('Fichier du jeu de variables téléchargé')).toBeInTheDocument();
  });

  test('importe un fichier puis ouvre l\'editeur du nouveau jeu', async () => {
    const user = userEvent.setup();
    const importTemplateDefinition = vi.fn(async (_input: TemplateDefinitionImportInput) => ({ templateId: 't-new', versionId: 'v-new', baseId: null }));
    renderMine(repo({ exportTemplateDefinition: vi.fn(), importTemplateDefinition }));
    await screen.findByText('Mon Neuro');

    await user.click(screen.getByRole('button', { name: 'Nouveau' }));
    expect(screen.getByRole('button', { name: 'Importer un fichier MedData' })).toBeInTheDocument();
    const file = new File([JSON.stringify(definition)], 'neuro.meddata.json', { type: 'application/json' });
    await user.upload(screen.getByTestId('template-definition-input'), file);

    await waitFor(() => expect(importTemplateDefinition).toHaveBeenCalledTimes(1));
    expect(importTemplateDefinition.mock.calls[0][0]).toMatchObject({ definition, name: 'Neurochirurgie' });
    expect(await screen.findByRole('heading', { name: 'Neurochirurgie' })).toBeInTheDocument();
  });

  test('un fichier qui n\'est pas un export MedData est refuse sans appel serveur', async () => {
    const importTemplateDefinition = vi.fn();
    renderMine(repo({ exportTemplateDefinition: vi.fn(), importTemplateDefinition }));
    await screen.findByText('Mon Neuro');
    const file = new File(['{"format":"autre"}'], 'x.json', { type: 'application/json' });
    await userEvent.upload(screen.getByTestId('template-definition-input'), file);
    expect(await screen.findByText('Ce fichier n’est pas un jeu de variables exporté depuis MedData.')).toBeInTheDocument();
    expect(importTemplateDefinition).not.toHaveBeenCalled();
  });
});
