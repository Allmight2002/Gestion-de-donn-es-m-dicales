// @vitest-environment jsdom
// Tests de rendu de l'admin gabarits (cahier §8.2) avec un repository INJECTE.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import { ToastProvider } from '../../components/Toast';
import { TemplatesAdmin } from './TemplatesAdmin';
import { TemplateVersionEditor } from './TemplateVersionEditor';
import type { TemplateRepository } from '../../data/templates';
import type { TemplateField, TemplateVersion, VersionStatus } from '../../data/types';

// `seed` : variables DEJA presentes dans la version, telles que le serveur les renverrait
// (avec consigne, valeur proposee, etc.). Sans lui, seul un champ cree via le formulaire
// peut etre edite, et il ne porte alors que ce que le formulaire a rempli.
function statefulMock(status: VersionStatus, seed: TemplateField[] = []): TemplateRepository {
  const version: TemplateVersion = { id: 'v1', templateId: 't1', versionNumber: 1, status };
  let fields: TemplateField[] = [...seed];
  let n = 0;
  return {
    async listTemplates() {
      return [{ id: 't1', name: 'Neurochirurgie', specialty: 'neuro', versions: [version] }];
    },
    async createTemplate(name) {
      return { template: { id: 't2', name, specialty: null }, version: { id: 'v2', templateId: 't2', versionNumber: 1, status: 'draft' } };
    },
    async createPersonalTemplate() {
      return { id: 'vperso', templateId: 'tperso', versionNumber: 1, status: 'draft' };
    },
    async createTemplateBundle() {
      return { templateId: 'tbundle', versionId: 'vbundle', baseId: null };
    },
    async getVersion() {
      return { version, fields: [...fields], rules: [], sections: [] };
    },
    async addField(_v, f, companion) {
      const add = (item: typeof f) => {
        const nf: TemplateField = {
          id: `f${++n}`, fieldKey: item.fieldKey, label: item.label, scope: item.scope, section: item.section, type: item.type,
          unit: item.unit ?? null, allowedValues: item.allowedValues ?? null, required: item.required,
          minValue: item.minValue ?? null, maxValue: item.maxValue ?? null,
          allowMissingCodes: item.allowMissingCodes ?? false, displayOrder: n,
        };
        fields.push(nf);
        return nf;
      };
      const nf = add(f);
      if (companion) add(companion);
      return nf;
    },
    async updateField(id, f) {
      const i = fields.findIndex((x) => x.id === id);
      fields[i] = { ...fields[i], fieldKey: f.fieldKey, label: f.label, scope: f.scope, section: f.section, type: f.type, required: f.required };
      return fields[i];
    },
    async deleteField(id) {
      fields = fields.filter((x) => x.id !== id);
    },
    async reorderFields(_v, orderedIds) {
      fields = orderedIds.map((id) => fields.find((x) => x.id === id)!).filter(Boolean);
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
    async createNextVersion() {
      return { id: 'vnext', templateId: 't1', versionNumber: 2, status: 'draft' };
    },
    async renameTemplate() {},
    async deleteTemplate() {},
  };
}

function renderAdmin(repo: TemplateRepository) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <RepositoryProvider templates={repo}>
          <MemoryRouter>
            <TemplatesAdmin />
          </MemoryRouter>
        </RepositoryProvider>
      </ToastProvider>
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

async function openTemplateActions() {
  await userEvent.click(screen.getByRole('button', { name: /Actions.*Neurochirurgie/ }));
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
    await user.click(screen.getByRole('button', { name: 'Nouveau modèle' }));
    // L'editeur affiche la section "Champs".
    expect(await screen.findByText('Champs')).toBeInTheDocument();
  });

  test('renommer un gabarit appelle renameTemplate', async () => {
    const user = userEvent.setup();
    const renameTemplate = vi.fn(async () => {});
    renderAdmin({ ...statefulMock('draft'), renameTemplate });
    await screen.findByText('Neurochirurgie');
    await openTemplateActions();
    await user.click(screen.getByRole('button', { name: 'Renommer' }));
    const nameInput = screen.getByDisplayValue('Neurochirurgie');
    await user.clear(nameInput);
    await user.type(nameInput, 'Neuro v2');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(renameTemplate).toHaveBeenCalledWith('t1', 'Neuro v2', 'neuro'));
  });

  test('supprimer un gabarit demande confirmation puis appelle deleteTemplate', async () => {
    const user = userEvent.setup();
    const deleteTemplate = vi.fn(async () => {});
    renderAdmin({ ...statefulMock('draft'), deleteTemplate });
    await screen.findByText('Neurochirurgie');
    await openTemplateActions();
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(screen.getByText('Confirmer la suppression ?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Oui' }));
    await waitFor(() => expect(deleteTemplate).toHaveBeenCalledWith('t1'));
  });

  // D1 : meme exigence que cote medecin, l'ecran admin partageait le meme motif fautif.
  test('un refus serveur est annonce au point de clic et referme la confirmation', async () => {
    const user = userEvent.setup();
    const deleteTemplate = vi.fn(async () => {
      throw new Error('Gabarit utilise par une base');
    });
    renderAdmin({ ...statefulMock('draft'), deleteTemplate });
    await screen.findByText('Neurochirurgie');
    await openTemplateActions();
    await user.click(screen.getByRole('button', { name: 'Supprimer' }));
    await user.click(screen.getByRole('button', { name: 'Oui' }));

    expect(await screen.findByText('Gabarit utilise par une base')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Confirmer la suppression ?')).toBeNull());
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

  test('ajoute le champ source et sa proposition par un seul appel repository', async () => {
    const user = userEvent.setup();
    const repo = statefulMock('draft');
    const addField = vi.spyOn(repo, 'addField');
    renderEditor(repo);
    await screen.findByText('Champs');
    await user.selectOptions(screen.getByLabelText('Type'), 'select');
    await user.type(screen.getByLabelText('Clé technique'), 'diagnostic');
    await user.type(screen.getByLabelText('Libellé'), 'Diagnostic');
    await user.click(screen.getByRole('checkbox', { name: 'Permettre de proposer une valeur hors liste' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter un champ' }));

    await waitFor(() => expect(addField).toHaveBeenCalledOnce());
    expect(addField).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ fieldKey: 'diagnostic' }),
      expect.objectContaining({ fieldKey: 'diagnostic_autre', type: 'text' }),
    );
    expect(await screen.findByText('Diagnostic — valeur proposée')).toBeInTheDocument();
  });

  test('ajoute aussi le compagnon d un diagnostic de terminologie permanent', async () => {
    const user = userEvent.setup();
    const repo = statefulMock('draft');
    const addField = vi.spyOn(repo, 'addField');
    renderEditor(repo);
    await screen.findByText('Champs');
    await user.selectOptions(screen.getByLabelText('Portée'), 'patient');
    await user.selectOptions(screen.getByLabelText('Type'), 'terminology');
    await user.type(screen.getByLabelText('Clé technique'), 'diagnostic');
    await user.type(screen.getByLabelText('Libellé'), 'Diagnostic principal');
    await user.click(screen.getByRole('checkbox', { name: 'Permettre de signaler un diagnostic absent du référentiel' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter un champ' }));

    await waitFor(() => expect(addField).toHaveBeenCalledOnce());
    expect(addField).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ fieldKey: 'diagnostic', type: 'terminology', scope: 'patient' }),
      expect.objectContaining({ fieldKey: 'diagnostic_autre', type: 'text', scope: 'patient', required: false }),
    );
  });

  test('un conflit de clé compagnon ne crée rien et conserve le formulaire', async () => {
    const user = userEvent.setup();
    const repo = statefulMock('draft');
    const addField = vi.spyOn(repo, 'addField');
    renderEditor(repo);
    await screen.findByText('Champs');
    await user.type(screen.getByLabelText('Clé technique'), 'diagnostic_autre');
    await user.type(screen.getByLabelText('Libellé'), 'Champ existant');
    await user.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    expect(await screen.findByText('Champ existant')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Type'), 'select');
    await user.type(screen.getByLabelText('Clé technique'), 'diagnostic');
    await user.type(screen.getByLabelText('Libellé'), 'Diagnostic');
    await user.click(screen.getByRole('checkbox', { name: 'Permettre de proposer une valeur hors liste' }));
    await user.click(screen.getByRole('button', { name: 'Ajouter un champ' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/soupape n’a pas été ajoutée/i);
    expect(addField).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Clé technique')).toHaveValue('diagnostic');
  });

  test('modifier un champ pre-remplit le formulaire et enregistre le nouveau libelle', async () => {
    const user = userEvent.setup();
    renderEditor(statefulMock('draft'));
    await screen.findByText('Champs');
    await user.type(screen.getByLabelText('Clé technique'), 'glasgow');
    await user.type(screen.getByLabelText('Libellé'), 'Glasgow');
    await user.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    await screen.findByText('Glasgow');

    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    const label = screen.getByDisplayValue('Glasgow');
    await user.clear(label);
    await user.type(label, 'Glasgow modifié');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Glasgow modifié')).toBeInTheDocument();
  });

  test('permet de reordonner les champs sur mobile avec des boutons explicites', async () => {
    const user = userEvent.setup();
    const repo = statefulMock('draft');
    const reorderFields = vi.spyOn(repo, 'reorderFields');
    renderEditor(repo);
    await screen.findByText('Champs');

    await user.type(screen.getByLabelText('Clé technique'), 'premier');
    await user.type(screen.getByLabelText('Libellé'), 'Premier');
    await user.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    await screen.findByText('Premier');
    await user.type(screen.getByLabelText('Clé technique'), 'second');
    await user.type(screen.getByLabelText('Libellé'), 'Second');
    await user.click(screen.getByRole('button', { name: 'Ajouter un champ' }));
    await screen.findByText('Second');

    await user.click(screen.getByRole('button', { name: 'Monter · Second' }));
    await waitFor(() => expect(reorderFields).toHaveBeenLastCalledWith('v1', ['f2', 'f1']));
  });

  // L21 — corriger un libelle ne doit pas toucher a la cardinalite. Sans `isMultiple` dans le
  // pre-remplissage, le formulaire repart sur « une seule valeur » et `updateField` recoit
  // false : une variable multivaluee redevient unitaire alors que personne n'y a touche.
  test('modifier le seul libelle conserve la cardinalite multivaluee', async () => {
    const user = userEvent.setup();
    const repo = statefulMock('draft', [{
      id: 'f1', fieldKey: 'diagnostic', label: 'Diagnostic principal',
      scope: 'encounter', section: 'clinique', type: 'terminology', isMultiple: true,
      unit: null, allowedValues: null, required: false, minValue: null, maxValue: null,
      allowMissingCodes: false, displayOrder: 1,
    }]);
    const updateField = vi.spyOn(repo, 'updateField');
    renderEditor(repo);
    await screen.findByText('Diagnostic principal');

    await user.click(screen.getByRole('button', { name: 'Modifier' }));
    // Le formulaire doit PORTER la cardinalite : c'est ce qui la renverra intacte.
    expect(screen.getByRole('checkbox', { name: 'Accepte plusieurs valeurs' })).toBeChecked();

    const label = screen.getByLabelText('Libellé');
    await user.clear(label);
    await user.type(label, 'Diagnostic retenu');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(updateField).toHaveBeenCalledOnce());
    expect(updateField).toHaveBeenCalledWith('f1', expect.objectContaining({
      label: 'Diagnostic retenu',
      type: 'terminology',
      isMultiple: true,
    }));
  });

  test('propose uniquement le constructeur de regles guide', async () => {
    renderEditor(statefulMock('draft'));
    await screen.findByText('Règles');
    expect(screen.getByLabelText('Type de règle')).toBeInTheDocument();
    expect(screen.queryByText(/Mode expert/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/JSON/i)).not.toBeInTheDocument();
  });

  test('nomme les colonnes d actions et rend la suppression verrouillee explicite', async () => {
    const repo = statefulMock('draft');
    const lockedField: TemplateField = {
      id: 'locked', fieldKey: 'patient_code', label: 'Code patient', scope: 'patient', section: 'clinique', type: 'text',
      unit: null, allowedValues: null, required: true, minValue: null, maxValue: null,
      allowMissingCodes: false, displayOrder: 1, inUse: true,
    };
    renderEditor({
      ...repo,
      async getVersion() {
        return {
          version: { id: 'v1', templateId: 't1', versionNumber: 1, status: 'draft' },
          fields: [lockedField],
          rules: [],
          sections: [],
        };
      },
    });

    expect(await screen.findByRole('columnheader', { name: 'Glisser pour réordonner' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDisabled();
  });
});

describe('TemplateVersionEditor (publiee)', () => {
  test('lecture seule : pas de formulaire d ajout, mention affichee', async () => {
    renderEditor(statefulMock('published'));
    expect(await screen.findByText(/lecture seule/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter un champ' })).toBeNull();
  });
});

// L29 — l'apercu s'ouvre depuis l'editeur, sur brouillon comme sur version publiee : voir
// le formulaire que les gens saisissent aujourd'hui vaut autant que voir un brouillon.
describe('TemplateVersionEditor — aperçu du formulaire', () => {
  test.each(['draft', 'published'] as const)('s ouvre puis se referme (version %s)', async (status) => {
    const user = userEvent.setup();
    renderEditor(statefulMock(status));
    await screen.findByText('Champs');

    await user.click(screen.getByRole('button', { name: 'Aperçu du formulaire' }));
    expect(await screen.findByRole('tab', { name: /Rencontre/ })).toBeInTheDocument();
    expect(screen.queryByText('Champs')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Retour à l’éditeur/ }));
    expect(await screen.findByText('Champs')).toBeInTheDocument();
  });
});
