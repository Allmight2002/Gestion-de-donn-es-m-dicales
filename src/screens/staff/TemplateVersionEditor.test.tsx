// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RepositoryProvider } from '../../data/RepositoryProvider';
import type { TemplateRepository } from '../../data/templates';
import type { ImportableBlock, TemplateField, TemplateSection, TemplateVersion } from '../../data/types';
import { TemplateVersionEditor } from './TemplateVersionEditor';

const version: TemplateVersion = {
  id: 'version-1',
  templateId: 'template-1',
  versionNumber: 3,
  status: 'draft',
};

const sections: TemplateSection[] = [
  { id: 'section-1', sectionKey: 'clinique', label: 'Clinique', displayOrder: 1 },
  { id: 'section-2', sectionKey: 'biologie', label: 'Biologie', displayOrder: 2 },
];

function makeField(overrides: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label'>): TemplateField {
  const { id, fieldKey, label, ...rest } = overrides;
  return {
    id,
    fieldKey,
    label,
    scope: 'encounter',
    section: 'clinique',
    type: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 1,
    ...rest,
  };
}

const block: ImportableBlock = {
  templateId: 'template-2', templateName: 'Pneumologie', isGlobal: false,
  versionId: 'version-2', versionNumber: 1, versionStatus: 'draft',
  sectionKey: 'tuberculose', label: 'Tuberculose', displayOrder: 0,
  subsectionCount: 1, fieldCount: 4,
};

function makeRepository() {
  let fields: TemplateField[] = [
    makeField({ id: 'field-1', fieldKey: 'tension', label: 'Tension artérielle', required: true }),
    makeField({ id: 'field-2', fieldKey: 'hemoglobine', label: 'Hémoglobine', section: 'biologie', type: 'number', displayOrder: 2 }),
  ];
  const updateField = vi.fn(async (id: string, next: Parameters<TemplateRepository['updateField']>[1]) => {
    const current = fields.find((field) => field.id === id);
    if (!current) throw new Error('Variable introuvable');
    const updated = { ...current, ...next };
    fields = fields.map((field) => (field.id === id ? { ...updated, id } : field));
    return fields.find((field) => field.id === id)!;
  });
  const repo = {
    getVersion: vi.fn(async () => ({ version, fields: [...fields], rules: [], sections })),
    updateField,
  } as unknown as TemplateRepository;
  return { repo, updateField };
}

function renderEditor(repo: TemplateRepository) {
  return render(
    <I18nProvider>
      <RepositoryProvider templates={repo}>
        <TemplateVersionEditor versionId={version.id} templateName="Registre fictif" onBack={() => {}} />
      </RepositoryProvider>
    </I18nProvider>,
  );
}

describe('TemplateVersionEditor', () => {
  test('regroupe les variables et filtre par libelle ou cle technique', async () => {
    const user = userEvent.setup();
    const { repo } = makeRepository();
    renderEditor(repo);

    expect(await screen.findByRole('heading', { name: 'Registre fictif' })).toBeInTheDocument();
    expect(screen.getByText('Version 3 · Brouillon')).toBeInTheDocument();
    // Le sommaire remplace les groupes deplies : chaque section y est atteignable en un clic,
    // avec son compte lisible dans le nom de la commande.
    const sommaire = within(screen.getByRole('navigation', { name: 'Sommaire du formulaire' }));
    expect(sommaire.getByRole('button', { name: 'Clinique · 1 variable(s)' })).toBeInTheDocument();
    expect(sommaire.getByRole('button', { name: 'Biologie · 1 variable(s)' })).toBeInTheDocument();
    // La zone principale ne montre QUE la section active : ouvrir un grand modele ne commence
    // pas par derouler toutes ses variables.
    const principal = within(document.getElementById('editor-panel-structure') as HTMLElement);
    expect(principal.getByText('Tension artérielle')).toBeInTheDocument();
    expect(principal.queryByText('Hémoglobine')).not.toBeInTheDocument();

    const toolbar = screen.getByTestId('template-editor-toolbar');
    expect(toolbar).toHaveClass('md:sticky', 'md:top-0', 'dark:bg-slate-950/95');
    expect(toolbar).not.toHaveClass('sticky', 'top-0');

    await user.type(screen.getByRole('searchbox', { name: 'Rechercher une variable' }), 'hemoglobine');

    // La recherche ne se limite pas au bloc ouvert : elle bascule sur « Toutes les variables »
    // et rend la variable trouvee, quelle que soit la section qui la porte.
    expect(principal.getByText('Hémoglobine')).toBeInTheDocument();
    expect(principal.queryByText('Tension artérielle')).not.toBeInTheDocument();
    // UX-14(a) : la portee du filtre se lit en toutes lettres, a cote de l'etat du panneau.
    expect(screen.getByText('1 variables affichées sur 2')).toBeInTheDocument();
    expect(screen.getByText('Aucune modification')).toBeInTheDocument();
    // Un resultat porte son chemin : on sait dans quelle section il se trouve, meme quand la
    // recherche a quitte le bloc ouvert.
    const trouve = principal.getByText('Hémoglobine').closest('[role="row"]') as HTMLElement;
    expect(within(trouve).getByText('Biologie')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }));
    expect(screen.getByText('2 variables affichées sur 2')).toBeInTheDocument();
    expect(principal.getByText('Tension artérielle')).toBeInTheDocument();
  });

  test('ouvre une variable dans le panneau, conserve les valeurs et permet de passer a la suivante', async () => {
    const user = userEvent.setup();
    const { repo, updateField } = makeRepository();
    renderEditor(repo);

    // « Suivante » se deplace dans les RESULTATS AFFICHES. Depuis une section, la suivante est
    // la suivante de cette section ; la sous-vue « Toutes les variables » parcourt le modele
    // entier, ce que ce scenario verifie.
    await user.click(await screen.findByRole('button', { name: /^Toutes les variables/ }));
    const firstRow = await screen.findByRole('row', { name: /Tension artérielle/ });
    await user.click(within(firstRow).getByRole('button', { name: /Modifier la variable/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Modifier la variable' });
    const label = within(dialog).getByLabelText('Libellé');
    expect(label).toHaveValue('Tension artérielle');
    await user.clear(label);
    await user.type(label, 'Tension corrigée');
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer et passer à la suivante' }));

    await waitFor(() => expect(updateField).toHaveBeenCalledWith('field-1', expect.objectContaining({ label: 'Tension corrigée' })));
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Modifier la variable' })).getByLabelText('Libellé')).toHaveValue('Hémoglobine'));
  });

  // --- L59 : la commande d'import ---------------------------------------------------------

  test('offre « Importer un bloc » a cote de « Ajouter une section » et ouvre le panneau', async () => {
    const user = userEvent.setup();
    const { repo } = makeRepository();
    const listImportableSections = vi.fn(async () => []);
    renderEditor(Object.assign(repo, { listImportableSections }));

    // La gestion de la structure (sections, rubriques communes, import) est repliee dans
    // l'espace Structure : on l'ouvre a la demande, au lieu d'un espace separe.
    await user.click(await screen.findByRole('button', { name: 'Gérer la structure' }));
    const command = await screen.findByRole('button', { name: 'Importer un bloc' });
    // La commande est bien dans le formulaire de creation de section, pas ailleurs.
    expect(command.closest('form')).toContainElement(screen.getByRole('button', { name: 'Ajouter la section' }));

    await user.click(command);
    const dialog = await screen.findByRole('dialog', { name: 'Importer un bloc réutilisable' });
    // Catalogue vide : etat explicite, jamais un ecran blanc.
    expect(await within(dialog).findByText(/Aucun bloc à importer pour l’instant/)).toBeInTheDocument();
    expect(listImportableSections).toHaveBeenCalledTimes(1);
  });

  test('version publiee : aucune commande d import, l editeur de sections n existe pas', async () => {
    const user = userEvent.setup();
    const { repo } = makeRepository();
    const published = { ...version, status: 'published' as const };
    renderEditor(Object.assign(repo, {
      getVersion: vi.fn(async () => ({ version: published, fields: [], rules: [], sections })),
      listImportableSections: vi.fn(async () => [block]),
    }));

    expect(await screen.findByText(/Version publiée/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gérer la structure' }));
    expect(screen.queryByRole('button', { name: 'Importer un bloc' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter la section' })).not.toBeInTheDocument();
  });

  test('serveur sans catalogue : la commande ne se rend pas du tout', async () => {
    const user = userEvent.setup();
    const { repo } = makeRepository();
    renderEditor(repo);

    // Le frontend ne doit jamais dependre d'une RPC absente : sans `listImportableSections`,
    // la commande disparait au lieu d'echouer au clic.
    await user.click(await screen.findByRole('button', { name: 'Gérer la structure' }));
    expect(await screen.findByRole('button', { name: 'Ajouter la section' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Importer un bloc' })).not.toBeInTheDocument();
  });

  // L60 — le parcours entier, de l'import a la regle ecrite. Ce que le panneau seul ne peut
  // pas prouver : que la creation passe bien par `addRule`, le CHEMIN EXISTANT, et non par
  // une ecriture parallele.
  describe('L60 — reconnexion de l’activation apres import', () => {
    const RELEASE = '11111111-1111-4111-8111-111111111111';
    const driver = makeField({
      id: 'field-diag', fieldKey: 'diagnostics', label: 'Diagnostics',
      section: null, type: 'terminology', isMultiple: true,
    });
    /** Variable arrivee avec le bloc : sans elle le bloc serait vide au sens de L55. */
    const carried = makeField({
      id: 'field-bk', fieldKey: 'bk_crachats', label: 'BK crachats', section: 'tuberculose',
    });

    /** Version cible apres import : le bloc est la, sans aucune regle qui le porte. */
    function importedRepo(over: { diagnosisContext?: TemplateVersion['diagnosisContext'] } = {}) {
      const addRule = vi.fn(async () => ({ id: 'rule-1', rule: {}, message: null, severity: 'block' as const }));
      const target: TemplateVersion = {
        ...version,
        diagnosisConfiguration: [{ scope: 'encounter', diagnosisFieldKey: 'diagnostics', terminologyReleaseId: RELEASE, commonOnlyCodes: [] }],
        diagnosisContext: over.diagnosisContext === undefined
          ? [{ scope: 'encounter', diagnosisFieldKey: 'diagnostics', terminologyReleaseId: RELEASE,
            commonOnlyCodes: [], proposalFieldKey: 'diagnostics_autre', recognizedCodes: ['A15.0'] }]
          : over.diagnosisContext,
      };
      const repo = {
        getVersion: vi.fn(async () => ({
          version: target,
          fields: [driver, carried],
          rules: [],
          sections: [...sections, { id: 'section-tb', sectionKey: 'tuberculose', label: 'Tuberculose', displayOrder: 3 }],
        })),
        addRule,
        listImportableSections: vi.fn(async () => [block]),
        previewSectionImport: vi.fn(async () => rapport),
        importSection: vi.fn(async () => rapport),
        getFields: vi.fn(async () => [driver, carried]),
      } as unknown as TemplateRepository;
      return { repo, addRule };
    }

    const rapport = {
      sectionKey: 'tuberculose', subsections: [], importedFields: ['bk_crachats'], reusedFields: [],
      copiedRules: 0,
      activationRule: { field: 'diagnostics', operator: 'contains_any', value: ['A15.0'], terminologyReleaseId: RELEASE },
      conflicts: [],
    };

    /** Importe le bloc puis demande a le conditionner : on arrive dans l'espace Regles. */
    async function importerPuisConditionner(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole('button', { name: 'Gérer la structure' }));
      await user.click(await screen.findByRole('button', { name: 'Importer un bloc' }));
      await user.selectOptions(await screen.findByLabelText(/Bloc à importer/), 'version-2::tuberculose');
      await screen.findByText(/Ce qui sera écrit/);
      await user.click(screen.getByRole('button', { name: 'Importer ce bloc' }));
      await user.click(await screen.findByRole('button', { name: 'Conditionner ce bloc' }));
    }

    test('cible compatible : la regle est ecrite par addRule, sous sa forme canonique', async () => {
      const user = userEvent.setup();
      const { repo, addRule } = importedRepo();
      renderEditor(repo);
      await importerPuisConditionner(user);

      await user.click(await screen.findByRole('button', { name: /Créer cette règle/ }));
      await waitFor(() => expect(addRule).toHaveBeenCalledTimes(1));
      expect(addRule).toHaveBeenCalledWith(
        'version-1',
        { if: { field: 'diagnostics', operator: 'contains_any', value: ['A15.0'], terminologyReleaseId: RELEASE },
          then: { section: 'tuberculose', operator: 'visible' } },
        '',
        'block',
      );
    });

    test('cible incompatible : rien n’est ecrit, et l’avertissement de L59 reste affiche', async () => {
      const user = userEvent.setup();
      // Aucune configuration diagnostique : l'edition du referentiel n'est verifiable nulle part.
      const { repo, addRule } = importedRepo({ diagnosisContext: [] });
      renderEditor(repo);
      await importerPuisConditionner(user);

      expect(await screen.findByRole('alert')).toHaveTextContent(/ne déclare pas cette variable comme pilote diagnostique/);
      expect(screen.queryByRole('button', { name: /Créer cette règle/ })).not.toBeInTheDocument();
      // Le bloc reste visible sans condition, et l'ecran continue de le dire.
      expect(screen.getByText(/Le bloc est visible sans condition/)).toBeInTheDocument();
      expect(addRule).not.toHaveBeenCalled();
    });
  });
});

// UX-14 — cas dimensionnant : 216 variables et 24 regles fictives, generees ici (jamais
// copiees d'un jeu reel). Les scenarios T18, T23 et T24 de la specification y sont joues.
// Les interactions passent par `fireEvent` : sur un modele de cette taille, simuler chaque
// frappe couterait plusieurs secondes sans rien prouver de plus.
const BLOCK_COUNT = 12;
const FIELDS_PER_BLOCK = 18;
const RULE_COUNT = 24;
const LAST_FIELD_LABEL = 'Score de Glasgow tardif';

function largeSections(): TemplateSection[] {
  return Array.from({ length: BLOCK_COUNT }, (_, index) => ({
    id: `bloc-${index}`, sectionKey: `bloc_${index}`, label: `Bloc ${index + 1}`, displayOrder: index,
  }));
}

function largeFields(): TemplateField[] {
  return Array.from({ length: BLOCK_COUNT * FIELDS_PER_BLOCK }, (_, index) => makeField({
    id: `grosse-${index}`,
    fieldKey: `var_${index}`,
    label: index === BLOCK_COUNT * FIELDS_PER_BLOCK - 1 ? LAST_FIELD_LABEL : `Variable ${index + 1}`,
    section: `bloc_${Math.floor(index / FIELDS_PER_BLOCK)}`,
    type: index % 5 === 0 ? 'select' : 'text',
    allowedValues: index % 5 === 0 ? ['oui', 'non'] : null,
    displayOrder: index,
  }));
}

function largeRules() {
  return Array.from({ length: RULE_COUNT }, (_, index) => ({
    id: `regle-${index}`,
    rule: {
      if: { field: `var_${index * 5}`, operator: 'equals', value: 'oui' },
      then: { field: `var_${index * 5 + 1}`, operator: 'required' },
    },
    message: null,
    severity: 'block' as const,
  }));
}

function makeLargeRepository() {
  let fields = largeFields();
  const sectionsList = largeSections();
  const updateField = vi.fn(async (id: string, next: Parameters<TemplateRepository['updateField']>[1]) => {
    const current = fields.find((field) => field.id === id);
    if (!current) throw new Error('Variable introuvable');
    fields = fields.map((field) => (field.id === id ? { ...field, ...next, id } : field));
    return fields.find((field) => field.id === id)!;
  });
  const reorderFields = vi.fn(async () => {});
  const repo = {
    getVersion: vi.fn(async () => ({ version, fields: [...fields], rules: largeRules(), sections: sectionsList })),
    updateField,
    reorderFields,
  } as unknown as TemplateRepository;
  return { repo, updateField, reorderFields };
}

const searchVariables = () => screen.getByRole('searchbox', { name: 'Rechercher une variable' });
const filterSection = (sectionKey: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: 'Filtrer par section' }), { target: { value: sectionKey } });
/**
 * Les quatre espaces restent MONTES pour ne perdre aucune saisie ; les panneaux inactifs
 * portent `hidden`. `getByText` ne respecte pas `hidden` : un libelle de variable apparait
 * aussi dans les `<option>` du filtre de l'espace Regles. Les lectures de liste se font donc
 * dans l'espace Structure.
 */
const structure = () => within(document.getElementById('editor-panel-structure') as HTMLElement);
const openVariable = (label: string) => {
  const row = structure().getByText(label).closest('[role="row"]') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: /Modifier la variable/ }));
};
const panel = () => screen.getByRole('dialog', { name: 'Modifier la variable' });

describe('TemplateVersionEditor — 216 variables / 24 regles (UX-14)', () => {
  test('T23 : retrouver une variable de fin de modele, la modifier, garder filtre et position', async () => {
    const { repo, updateField } = makeLargeRepository();
    renderEditor(repo);

    await screen.findByRole('heading', { name: 'Registre fictif' });
    // L'ecran s'ouvre sur le PREMIER bloc, pas sur les 216 lignes : on ne traverse pas les
    // variables des sections precedentes pour atteindre celles qu'on vient voir.
    expect(screen.getByText('18 variables affichées sur 216')).toBeInTheDocument();
    expect(structure().getByText('Variable 1')).toBeInTheDocument();
    expect(structure().queryByText(LAST_FIELD_LABEL)).not.toBeInTheDocument();

    // La recherche porte sur TOUT le modele, y compris les blocs fermes.
    fireEvent.change(searchVariables(), { target: { value: 'Glasgow tardif' } });
    expect(screen.getByText('1 variables affichées sur 216')).toBeInTheDocument();

    openVariable(LAST_FIELD_LABEL);
    expect(within(panel()).getByText(/Variable 1 sur 1 des résultats affichés/)).toBeInTheDocument();
    expect(within(panel()).getByText(/Section : Bloc 12/)).toBeInTheDocument();
    expect(within(panel()).getByText('Dernière variable des résultats affichés')).toBeInTheDocument();

    fireEvent.change(within(panel()).getByLabelText('Libellé'), { target: { value: 'Score tardif corrige' } });
    expect(within(panel()).getByText('Modifications non enregistrées')).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(updateField).toHaveBeenCalledWith('grosse-215', expect.objectContaining({ label: 'Score tardif corrige' })));
    // La recherche est conservee apres l'enregistrement...
    expect(searchVariables()).toHaveValue('Glasgow tardif');
    // ... et la sortie du filtre est annoncee, avec un acces direct a la variable.
    expect(await screen.findByText(/ne correspond plus aux filtres affichés/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voir la variable' }));
    expect(searchVariables()).toHaveValue('');
    expect(screen.getByText('216 variables affichées sur 216')).toBeInTheDocument();
  });

  test('T23 : passer a la variable suivante ne perd pas une edition non enregistree', async () => {
    const { repo, updateField } = makeLargeRepository();
    renderEditor(repo);

    await screen.findByRole('heading', { name: 'Registre fictif' });
    filterSection('bloc_0');
    openVariable('Variable 1');
    fireEvent.change(within(panel()).getByLabelText('Libellé'), { target: { value: 'Variable 1 modifiee' } });

    fireEvent.click(within(panel()).getByRole('button', { name: /Variable suivante/ }));
    const garde = await screen.findByRole('dialog', { name: 'Quitter cette variable ?' });
    fireEvent.click(within(garde).getByRole('button', { name: 'Annuler' }));
    expect(within(panel()).getByLabelText('Libellé')).toHaveValue('Variable 1 modifiee');
    expect(updateField).not.toHaveBeenCalled();

    fireEvent.click(within(panel()).getByRole('button', { name: /Variable suivante/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Quitter cette variable ?' }))
      .getByRole('button', { name: 'Continuer sans enregistrer' }));
    await waitFor(() => expect(within(panel()).getByLabelText('Libellé')).toHaveValue('Variable 2'));
    expect(updateField).not.toHaveBeenCalled();
  });

  test('T18 : une modification refusee garde le panneau ouvert, ses valeurs et son motif', async () => {
    const { repo } = makeLargeRepository();
    const refus = vi.fn(async () => { throw new Error('Version publiée : modification refusée'); });
    renderEditor(Object.assign(repo, { updateField: refus }));

    await screen.findByRole('heading', { name: 'Registre fictif' });
    filterSection('bloc_0');
    openVariable('Variable 1');
    fireEvent.change(within(panel()).getByLabelText('Libellé'), { target: { value: 'Libelle refuse' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(refus).toHaveBeenCalled());
    expect(within(panel()).getByLabelText('Libellé')).toHaveValue('Libelle refuse');
    await waitFor(() => expect(within(panel()).getByText('Échec de l’enregistrement')).toBeInTheDocument());
  });

  test('T24 : retrouver une regle au-dela des vingt premieres et atteindre ses variables', async () => {
    const { repo } = makeLargeRepository();
    renderEditor(repo);

    fireEvent.click(await screen.findByRole('tab', { name: /^Règles/ }));
    expect(screen.getByText('24 règle(s) affichée(s) sur 24')).toBeInTheDocument();

    // La 24e regle porte sur « Variable 116 » : elle se retrouve sans parcourir les autres.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher une règle' }), { target: { value: 'Variable 116' } });
    expect(screen.getByText('1 règle(s) affichée(s) sur 24')).toBeInTheDocument();

    // Depuis la regle, on atteint directement la variable qu'elle cite.
    fireEvent.click(screen.getByRole('button', { name: 'Variable 116' }));
    expect(within(panel()).getByLabelText('Libellé')).toHaveValue('Variable 116');
  });

  test('T24 : filtrer les regles par variable concernee, type et bloc', async () => {
    const { repo } = makeLargeRepository();
    renderEditor(repo);

    fireEvent.click(await screen.findByRole('tab', { name: /^Règles/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Variable concernée' }), { target: { value: 'var_6' } });
    expect(screen.getByText('1 règle(s) affichée(s) sur 24')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Variable concernée' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrer par type de règle' }), { target: { value: 'visibility' } });
    expect(screen.getByText('0 règle(s) affichée(s) sur 24')).toBeInTheDocument();
    expect(screen.getByText('Aucune règle ne correspond à ces critères.')).toBeInTheDocument();
  });

  test('trier l affichage ne reordonne jamais les donnees et suspend le deplacement', async () => {
    const { repo, reorderFields } = makeLargeRepository();
    renderEditor(repo);

    await screen.findByRole('heading', { name: 'Registre fictif' });
    filterSection('bloc_0');
    fireEvent.change(screen.getByRole('combobox', { name: 'Trier l’affichage' }), { target: { value: 'label' } });
    expect(screen.getByText(/l’ordre du formulaire est inchangé/)).toBeInTheDocument();
    expect(reorderFields).not.toHaveBeenCalled();

    const row = structure().getByText('Variable 1').closest('[role="row"]') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Descendre · Variable 1' })).toBeDisabled();
  });

  test('l index des sections conduit directement a un bloc de fin de modele', async () => {
    const { repo } = makeLargeRepository();
    renderEditor(repo);

    // Critere 1 : atteindre une section de FIN de modele sans traverser les precedentes.
    const sommaire = within(await screen.findByRole('navigation', { name: 'Sommaire du formulaire' }));
    const bloc12 = sommaire.getByRole('button', { name: 'Bloc 12 · 18 variable(s)' });
    fireEvent.click(bloc12);

    expect(bloc12).toHaveAttribute('aria-current', 'page');
    expect(structure().getByRole('heading', { name: 'Bloc 12' })).toBeInTheDocument();
    expect(structure().getByText(LAST_FIELD_LABEL)).toBeInTheDocument();
    // Les variables du bloc precedent ne sont plus dans la page : la zone principale ne montre
    // que la section active.
    expect(structure().queryByText('Variable 1')).not.toBeInTheDocument();
  });
});

// UX-14(c) — la liste des règles distingue ce qui s'applique à plusieurs cibles de ce qui
// se duplique : une comparaison n'a pas de sens multicible, et la spec interdit d'en déduire un.
describe('TemplateVersionEditor — créer des règles similaires (UX-14(c))', () => {
  const rulesFixture = [
    {
      id: 'r-cond',
      rule: { if: { field: 'tension', operator: 'equals', value: 'oui' }, then: { field: 'hemoglobine', operator: 'required' } },
      message: null,
      severity: 'block' as const,
    },
    {
      id: 'r-comp',
      rule: { operator: 'greater_or_equal', left_field: 'tension', right_field: 'hemoglobine' },
      message: null,
      severity: 'block' as const,
    },
  ];

  function repositoryWithRules(extra: Partial<TemplateRepository> = {}) {
    const fields = [
      makeField({ id: 'field-1', fieldKey: 'tension', label: 'Tension artérielle' }),
      makeField({ id: 'field-2', fieldKey: 'hemoglobine', label: 'Hémoglobine', section: 'biologie' }),
    ];
    return {
      getVersion: vi.fn(async () => ({ version, fields, rules: rulesFixture, sections })),
      ...extra,
    } as unknown as TemplateRepository;
  }

  test('propose le lot sur une règle conditionnelle et la duplication sur une comparaison', async () => {
    const user = userEvent.setup();
    const previewRuleBatch = vi.fn(async () => ({
      fingerprint: 'e1', severity: 'block' as const, create: [], duplicates: [], invalid: [], locked: false, inUse: false,
    }));
    renderEditor(repositoryWithRules({ previewRuleBatch, createRuleBatch: vi.fn() }));

    await user.click(await screen.findByRole('tab', { name: /^Règles/ }));
    expect(screen.getAllByRole('button', { name: 'Appliquer à plusieurs variables' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Dupliquer la règle' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Appliquer à plusieurs variables' }));
    const panneau = await screen.findByRole('dialog', { name: 'Appliquer cette condition à plusieurs variables' });
    // La condition reprise reste celle de la règle source ; l'écran ne la ressaisit pas.
    expect(within(panneau).getByText(/Tension artérielle/)).toBeInTheDocument();
  });

  test('sans contrat serveur, le lot n’est pas proposé : la duplication reste possible', async () => {
    const user = userEvent.setup();
    renderEditor(repositoryWithRules());

    await user.click(await screen.findByRole('tab', { name: /^Règles/ }));
    expect(screen.queryByRole('button', { name: 'Appliquer à plusieurs variables' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Dupliquer la règle' })).toHaveLength(2);

    // Dupliquer préremplit le formulaire guidé en CRÉATION : la règle source n'est pas modifiée.
    await user.click(screen.getAllByRole('button', { name: 'Dupliquer la règle' })[1]);
    await waitFor(() => expect(screen.getByLabelText('Variable à contrôler')).toHaveValue('tension'));
    expect(screen.getByLabelText('Variable de référence')).toHaveValue('hemoglobine');
  });
});

// UX-14(d) — déplacement direct. La rangée propose une commande explicite ; le glisser-déposer
// et les flèches restent, mais ils ne sont plus la seule façon de franchir 216 rangs.
describe('TemplateVersionEditor — déplacement direct (UX-14(d))', () => {
  test('déplace une variable vers une autre section sans réécrire ses attributs', async () => {
    const user = userEvent.setup();
    const reorderFields = vi.fn(async () => {});
    const { repo, updateField } = makeRepository();
    const withReorder = { ...repo, reorderFields } as unknown as TemplateRepository;
    renderEditor(withReorder);

    await user.click(await screen.findByRole('button', { name: 'Déplacer · Tension artérielle' }));
    const dialogue = screen.getByRole('dialog', { name: /Déplacer « Tension artérielle »/ });
    await user.selectOptions(within(dialogue).getByLabelText('Section d’arrivée'), 'biologie');
    await user.selectOptions(within(dialogue).getByLabelText('Variable de repère'), 'hemoglobine');
    // La destination est annoncée avant la confirmation, pas après.
    expect(within(dialogue).getByText(/sera placée après « Hémoglobine », dans Biologie/)).toBeInTheDocument();
    await user.click(within(dialogue).getByRole('button', { name: 'Déplacer la variable' }));

    // La section part par la voie de modification habituelle, avec TOUS les attributs relus.
    await waitFor(() => expect(updateField).toHaveBeenCalledTimes(1));
    expect(updateField.mock.calls[0][1]).toMatchObject({
      fieldKey: 'tension', label: 'Tension artérielle', section: 'biologie', required: true, type: 'text',
    });
    // Puis le rang, en une seule écriture d'ordre pour toute la version.
    expect(reorderFields).toHaveBeenCalledWith('version-1', ['field-2', 'field-1']);
  });

  test('un tri de consultation ne propose pas le déplacement : il n’écrit aucun ordre', async () => {
    const user = userEvent.setup();
    const { repo } = makeRepository();
    renderEditor({ ...repo, reorderFields: vi.fn() } as unknown as TemplateRepository);

    await user.selectOptions(await screen.findByLabelText('Trier l’affichage'), 'label');
    expect(screen.getByRole('button', { name: 'Déplacer · Tension artérielle' })).toBeDisabled();
  });
});
