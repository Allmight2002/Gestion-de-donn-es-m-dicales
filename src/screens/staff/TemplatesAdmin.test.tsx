// @vitest-environment jsdom
// Tests de rendu de l'admin gabarits (cahier §8.2) avec un repository INJECTE.
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { TemplatesAdmin } from './TemplatesAdmin';
import { TemplateVersionEditor } from './TemplateVersionEditor';
import type { TemplateRepository } from '../../data/templates';
import type { TemplateField, TemplateVersion, VersionStatus } from '../../data/types';

function statefulMock(status: VersionStatus): TemplateRepository {
  const version: TemplateVersion = { id: 'v1', templateId: 't1', versionNumber: 1, status };
  let fields: TemplateField[] = [];
  let n = 0;
  return {
    async listTemplates() {
      return [{ id: 't1', name: 'Neurochirurgie', specialty: 'neuro', versions: [version] }];
    },
    async createTemplate(name) {
      return { template: { id: 't2', name, specialty: null }, version: { id: 'v2', templateId: 't2', versionNumber: 1, status: 'draft' } };
    },
    async getVersion() {
      return { version, fields: [...fields], rules: [] };
    },
    async addField(_v, f) {
      const nf: TemplateField = {
        id: `f${++n}`, fieldKey: f.fieldKey, label: f.label, scope: f.scope, section: f.section, type: f.type,
        unit: null, allowedValues: null, required: f.required, minValue: null, maxValue: null,
        allowMissingCodes: true, displayOrder: n,
      };
      fields.push(nf);
      return nf;
    },
    async deleteField(id) {
      fields = fields.filter((x) => x.id !== id);
    },
    async promoteToGlobal() {},
    async addRule(_v, rule, message, severity) {
      return { id: 'r1', rule, message, severity };
    },
    async deleteRule() {},
    async publishVersion() {
      version.status = 'published';
    },
    async archiveVersion() {},
    async duplicateVersion() {
      return { id: 'vdup', templateId: 't1', versionNumber: 2, status: 'draft' };
    },
  };
}

function renderAdmin(repo: TemplateRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider templates={repo}>
        <MemoryRouter>
          <TemplatesAdmin />
        </MemoryRouter>
      </RepositoryProvider>
    </I18nProvider>,
  );
}

function renderEditor(repo: TemplateRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider templates={repo}>
        <TemplateVersionEditor versionId="v1" onBack={() => {}} />
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('TemplatesAdmin', () => {
  test('liste les gabarits existants', async () => {
    renderAdmin(statefulMock('draft'));
    expect(await screen.findByText('Neurochirurgie')).toBeInTheDocument();
  });

  test('creer un gabarit ouvre l editeur de version', async () => {
    const user = userEvent.setup();
    renderAdmin(statefulMock('draft'));
    await screen.findByText('Neurochirurgie');
    await user.type(screen.getByLabelText('Nom'), 'Cardiologie');
    await user.click(screen.getByRole('button', { name: 'Nouveau gabarit' }));
    // L'editeur affiche la section "Champs".
    expect(await screen.findByText('Champs')).toBeInTheDocument();
  });
});

describe('TemplateVersionEditor (brouillon)', () => {
  test('ajouter un champ l affiche dans la table', async () => {
    const user = userEvent.setup();
    renderEditor(statefulMock('draft'));
    await screen.findByText('Champs');
    await user.type(screen.getByLabelText('Clé technique'), 'glasgow_score');
    await user.type(screen.getByLabelText('Libellé'), 'Score de Glasgow');
    await user.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(await screen.findByText('Score de Glasgow')).toBeInTheDocument();
  });

  test('une regle JSON invalide affiche une erreur', async () => {
    const user = userEvent.setup();
    renderEditor(statefulMock('draft'));
    await screen.findByText('Règles');
    await user.type(screen.getByLabelText('Règle (JSON)'), 'pas du json');
    await user.click(screen.getByRole('button', { name: 'Ajouter une règle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalide/i);
  });
});

describe('TemplateVersionEditor (publiee)', () => {
  test('lecture seule : pas de formulaire d ajout, mention affichee', async () => {
    renderEditor(statefulMock('published'));
    expect(await screen.findByText(/lecture seule/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter un champ' })).toBeNull();
  });
});
