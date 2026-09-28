// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TemplateField, TemplateSection } from '../../data/types';
import { RuleForm, RuleSummary, ruleConditionKey, ruleConditionText } from './RuleForm';

const fields: TemplateField[] = [
  {
    id: 'f1',
    fieldKey: 'admission_date',
    label: 'Date d’admission',
    scope: 'encounter',
    section: 'clinique',
    type: 'date',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 1,
  },
  {
    id: 'f2',
    fieldKey: 'discharge_date',
    label: 'Date de sortie',
    scope: 'encounter',
    section: 'clinique',
    type: 'date',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 2,
  },
  {
    id: 'f3',
    fieldKey: 'intervention_type',
    label: 'Type d’intervention',
    scope: 'patient',
    section: 'clinique',
    type: 'select',
    unit: null,
    allowedValues: ['Chirurgie', 'Traitement médical'],
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 3,
  },
  {
    id: 'f4',
    fieldKey: 'operative_report',
    label: 'Compte rendu opératoire',
    scope: 'encounter',
    section: 'clinique',
    type: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 4,
  },
];

function renderForm(onSubmit = vi.fn()) {
  render(
    <I18nProvider>
      <RuleForm fields={fields} onSubmit={onSubmit} />
    </I18nProvider>,
  );
  return onSubmit;
}

describe('RuleForm', () => {
  test('contains_any conserve les codes de choix et reste absent des comparaisons', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    expect(screen.queryByRole('option', { name: 'contient au moins un de ces codes' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Type de règle'), 'conditional');
    await user.selectOptions(screen.getByLabelText('Variable de la condition'), 'intervention_type');
    await user.selectOptions(screen.getByLabelText('Relation clinique'), 'contains_any');
    await user.click(screen.getByRole('checkbox', { name: 'Chirurgie' }));
    await user.selectOptions(screen.getByLabelText('Variable rendue obligatoire'), 'operative_report');
    await user.click(screen.getByRole('button', { name: 'Ajouter une règle' }));
    expect(onSubmit).toHaveBeenCalledWith({
      if: { field: 'intervention_type', operator: 'contains_any', value: ['Chirurgie'] },
      then: { field: 'operative_report', operator: 'required' },
    }, '', 'block');
  });

  test('une règle diagnostique éditée conserve explicitement sa release et ses codes', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const initialRule = {
      if: { field: 'diagnosis', operator: 'contains_any', value: ['A', 'B'], terminologyReleaseId: 'aaaaaaaa-0000-0000-0000-000000000001' },
      then: { field: 'operative_report', operator: 'visible' },
    };
    render(<I18nProvider><RuleForm fields={[...fields, { ...fields[0], id: 'diagnosis', fieldKey: 'diagnosis', type: 'terminology', label: 'Diagnostic' }]}
      initialRule={initialRule} onSubmit={onSubmit} /></I18nProvider>);
    expect(screen.getByLabelText('Publication du référentiel liée à cette règle')).toHaveValue(initialRule.if.terminologyReleaseId);
    expect(screen.getByLabelText('Valeurs de la condition')).toHaveValue('A, B');
    await user.click(screen.getByRole('button', { name: 'Ajouter une règle' }));
    expect(onSubmit).toHaveBeenCalledWith(initialRule, '', 'block');
  });

  test('assemble une comparaison de dates avec le JSON historique', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.selectOptions(screen.getByLabelText('Variable à contrôler'), 'discharge_date');
    await user.selectOptions(screen.getByLabelText('Relation clinique'), 'greater_or_equal');
    await user.selectOptions(screen.getByLabelText('Variable de référence'), 'admission_date');

    expect(screen.getByText('Date de sortie est postérieure ou égale à Date d’admission.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ajouter une règle' }));

    expect(onSubmit).toHaveBeenCalledWith(
      { operator: 'greater_or_equal', left_field: 'discharge_date', right_field: 'admission_date' },
      '',
      'block',
    );
  });

  test('assemble une condition avec une liste de valeurs et une conséquence obligatoire', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.selectOptions(screen.getByLabelText('Type de règle'), 'conditional');
    await user.selectOptions(screen.getByLabelText('Variable de la condition'), 'intervention_type');
    await user.selectOptions(screen.getByLabelText('Relation clinique'), 'in');
    await user.click(screen.getByRole('checkbox', { name: 'Chirurgie' }));
    await user.selectOptions(screen.getByLabelText('Variable rendue obligatoire'), 'operative_report');
    await user.click(screen.getByRole('button', { name: 'Ajouter une règle' }));

    expect(onSubmit).toHaveBeenCalledWith(
      {
        if: { field: 'intervention_type', operator: 'in', value: ['Chirurgie'] },
        then: { field: 'operative_report', operator: 'required' },
      },
      '',
      'block',
    );
  });

  test('reste entierement guide sans exposer le mode expert ni le JSON', () => {
    renderForm();

    expect(screen.queryByText(/Mode expert/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/JSON/i)).not.toBeInTheDocument();
  });

  test('affiche la portée et réserve la clé technique aux libellés en doublon', () => {
    const duplicateFields = [
      { ...fields[0], id: 'duplicate-1', fieldKey: 'patient_date', label: 'Date', scope: 'patient' as const },
      { ...fields[1], id: 'duplicate-2', fieldKey: 'visit_date', label: 'Date', scope: 'encounter' as const },
    ];
    render(
      <I18nProvider>
        <RuleForm fields={duplicateFields} onSubmit={() => {}} />
      </I18nProvider>,
    );

    const leftField = screen.getByLabelText('Variable à contrôler');
    // UX-14(b) : section, type et portée accompagnent le libellé ; la clé technique reste
    // réservée aux libellés réellement en doublon.
    expect(within(leftField).getByRole('option', { name: /^Date — .* · Patient — patient_date$/ })).toBeInTheDocument();
    expect(within(leftField).getByRole('option', { name: /^Date — .* · Visite — visit_date$/ })).toBeInTheDocument();
  });

  test('relit une règle existante et permet de la corriger sans la recréer', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <RuleForm
          fields={fields}
          initialRule={{ operator: 'greater_or_equal', left_field: 'discharge_date', right_field: 'admission_date' }}
          initialMessage="La sortie doit suivre l’admission"
          initialSeverity="warn"
          submitLabel="Enregistrer la règle"
          onCancel={() => {}}
          onSubmit={onSubmit}
        />
      </I18nProvider>,
    );

    expect(screen.getByLabelText('Variable à contrôler')).toHaveValue('discharge_date');
    expect(screen.getByLabelText('Relation clinique')).toHaveValue('greater_or_equal');
    expect(screen.getByDisplayValue('La sortie doit suivre l’admission')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Relation clinique'), 'less_than');
    await user.click(screen.getByRole('button', { name: 'Enregistrer la règle' }));

    expect(onSubmit).toHaveBeenCalledWith(
      { operator: 'less_than', left_field: 'discharge_date', right_field: 'admission_date' },
      'La sortie doit suivre l’admission',
      'warn',
    );
  });

  // UX-14(b) : choisir une variable parmi 216 sans parcourir une liste native entiere.
  test('les selecteurs de variables deviennent recherchables sur un gros modele', async () => {
    const user = userEvent.setup();
    const many: TemplateField[] = Array.from({ length: 30 }, (_, index) => ({
      ...fields[0],
      id: `gros-${index}`,
      fieldKey: `variable_${index}`,
      label: index === 27 ? 'Score de Glasgow' : `Variable ${index}`,
      type: 'integer' as const,
      displayOrder: index,
    }));
    render(
      <I18nProvider>
        <RuleForm fields={many} onSubmit={() => {}} />
      </I18nProvider>,
    );

    // Audit UI mobile, lot 6 : recherche et liste ne font plus qu'une liste recherchable.
    const cible = screen.getByRole('combobox', { name: 'Variable à contrôler' });
    expect(screen.queryByLabelText('Rechercher une variable — Variable à contrôler')).not.toBeInTheDocument();
    await user.click(cible);
    const liste = screen.getByRole('listbox', { name: 'Variable à contrôler' });
    expect(within(liste).getAllByRole('option')).toHaveLength(31); // 30 variables + « Choisir »

    await user.type(cible, 'glasgow');
    expect(within(liste).getAllByRole('option')).toHaveLength(2);
    await user.click(within(liste).getByRole('option', { name: /Score de Glasgow/ }));
    // Le choix referme la liste et se lit dans le champ.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect((cible as HTMLInputElement).value).toMatch(/^Score de Glasgow/);

    // La variable choisie reste proposee meme si la recherche ne la retient plus :
    // filtrer ne doit jamais effacer une reponse deja donnee.
    await user.clear(cible);
    await user.type(cible, 'Variable 3');
    const filtree = screen.getByRole('listbox', { name: 'Variable à contrôler' });
    expect(within(filtree).getByRole('option', { name: /Score de Glasgow/ })).toHaveAttribute('aria-selected', 'true');
    // Echap referme la liste sans toucher au choix.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect((cible as HTMLInputElement).value).toMatch(/^Score de Glasgow/);
  });
  test('une recherche sans resultat le dit, et la valeur choisie reste proposee', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const many: TemplateField[] = Array.from({ length: 12 }, (_, index) => ({
      ...fields[0], id: `m-${index}`, fieldKey: `var_${index}`, label: `Variable ${index}`, displayOrder: index,
    }));
    render(
      <I18nProvider>
        <RuleForm fields={many} onSubmit={onSubmit} />
      </I18nProvider>,
    );

    const cible = screen.getByRole('combobox', { name: 'Variable à contrôler' });
    // Sans choix en cours, une recherche vide est annoncee comme telle.
    await user.type(cible, 'zzzz');
    expect(screen.getAllByText('Aucune variable ne correspond à cette recherche').length).toBeGreaterThan(0);

    // Au clavier : les fleches parcourent la liste, Entree choisit sans soumettre la regle.
    await user.clear(cible);
    await user.type(cible, 'Variable 3');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect((cible as HTMLInputElement).value).toMatch(/^Variable 3/);

    // Avec un choix en cours, la variable choisie reste proposee : filtrer n'efface pas une reponse.
    await user.clear(cible);
    await user.type(cible, 'zzzz');
    const liste = screen.getByRole('listbox', { name: 'Variable à contrôler' });
    expect(within(liste).getByRole('option', { name: /Variable 3/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('1 variable(s) sur 12').length).toBeGreaterThan(0);
  });
});

describe('RuleSummary', () => {
  test('relit une règle enregistrée comme une phrase clinique sans exposer son JSON', () => {
    render(
      <I18nProvider>
        <RuleSummary
          fields={fields}
          rule={{ operator: 'greater_or_equal', left_field: 'discharge_date', right_field: 'admission_date' }}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('Date de sortie est postérieure ou égale à Date d’admission.')).toBeInTheDocument();
    expect(screen.queryByText('Voir le JSON')).not.toBeInTheDocument();
    expect(screen.queryByText(/left_field/)).not.toBeInTheDocument();
  });
});

// Audit UI mobile, lot 0 : la regle stocke le code de l'option (L30), mais la phrase se lit
// avec son libelle, comme dans le formulaire qui l'a construite.
describe('RuleSummary — libellés des options', () => {
  const symptomes: TemplateField = {
    ...fields[2],
    id: 'f-symptomes',
    fieldKey: 'symptomes',
    label: 'Symptômes',
    type: 'multiselect',
    allowedValues: ['cephalees', 'hydrocephalie_trouble_du_lcr'],
    allowedOptions: [
      { value_key: 'cephalees', label: 'Céphalées', is_active: true },
      { value_key: 'hydrocephalie_trouble_du_lcr', label: 'Hydrocéphalie / trouble du LCR', is_active: true },
    ],
  };
  const withOptions = [...fields, symptomes];

  test('une règle enregistrée affiche les libellés, et une valeur hors liste telle quelle', () => {
    render(
      <I18nProvider>
        <RuleSummary
          fields={withOptions}
          rule={{
            if: { field: 'symptomes', operator: 'contains_any', value: ['cephalees', 'hydrocephalie_trouble_du_lcr', 'valeur_retiree'] },
            then: { field: 'operative_report', operator: 'visible' },
          }}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(
      'Si Symptômes contient au moins un de ces codes « Céphalées », « Hydrocéphalie / trouble du LCR », « valeur_retiree », alors Compte rendu opératoire est affichée.',
    )).toBeInTheDocument();
  });

  test('l’aperçu du formulaire affiche le libellé, la règle garde le code', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <RuleForm fields={withOptions} onSubmit={onSubmit} />
      </I18nProvider>,
    );

    await user.selectOptions(screen.getByLabelText('Type de règle'), 'visibility');
    await user.selectOptions(screen.getByLabelText('Variable de la condition'), 'symptomes');
    await user.selectOptions(screen.getByLabelText('Relation clinique'), 'equals');
    await user.selectOptions(screen.getByLabelText('Valeur de la condition'), 'Céphalées');
    await user.selectOptions(screen.getByLabelText('Variable affichée sous condition'), 'operative_report');

    expect(screen.getByText(
      'Si Symptômes est égal à « Céphalées », alors Compte rendu opératoire est affichée.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/« cephalees »/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ajouter une règle' }));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        if: { field: 'symptomes', operator: 'equals', value: 'cephalees' },
        then: { field: 'operative_report', operator: 'visible' },
      },
      '',
      'block',
    );
  });
});

describe('RuleForm — regle d\'affichage (L32)', () => {
  test('assemble une regle d\'affichage sans jamais montrer de JSON', async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();

    await user.selectOptions(screen.getByLabelText('Type de règle'), 'visibility');
    await user.selectOptions(screen.getByLabelText('Variable de la condition'), 'intervention_type');
    await user.selectOptions(screen.getByLabelText('Relation clinique'), 'equals');
    await user.selectOptions(screen.getByLabelText('Valeur de la condition'), 'Chirurgie');
    await user.selectOptions(screen.getByLabelText('Variable affichée sous condition'), 'operative_report');

    expect(screen.getByText(
      'Si Type d’intervention est égal à « Chirurgie », alors Compte rendu opératoire est affichée.',
    )).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ajouter une règle' }));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        if: { field: 'intervention_type', operator: 'equals', value: 'Chirurgie' },
        then: { field: 'operative_report', operator: 'visible' },
      },
      '',
      'block',
    );
  });

  test('annonce l\'effacement des valeurs, et ne demande pas de severite', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByLabelText('Sévérité')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Type de règle'), 'visibility');
    // Une regle d'affichage ne bloque ni n'avertit : lui demander une gravite serait faux.
    expect(screen.queryByLabelText('Sévérité')).toBeNull();
    expect(screen.getByText(/masquée, ses valeurs saisies sont retirées/)).toBeInTheDocument();
  });

  test('refuse un cycle en nommant les variables, avant tout envoi', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <RuleForm
          fields={fields}
          onSubmit={onSubmit}
          existingRules={[{
            rule: {
              if: { field: 'operative_report', operator: 'equals', value: 'x' },
              then: { field: 'intervention_type', operator: 'visible' },
            },
          }]}
        />
      </I18nProvider>,
    );

    await user.selectOptions(screen.getByLabelText('Type de règle'), 'visibility');
    await user.selectOptions(screen.getByLabelText('Variable de la condition'), 'intervention_type');
    await user.selectOptions(screen.getByLabelText('Relation clinique'), 'equals');
    await user.selectOptions(screen.getByLabelText('Valeur de la condition'), 'Chirurgie');
    await user.selectOptions(screen.getByLabelText('Variable affichée sous condition'), 'operative_report');
    await user.click(screen.getByRole('button', { name: 'Ajouter une règle' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/circulaire/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Compte rendu opératoire');
  });

  test('permet de cibler un bloc racine et ne propose jamais sa sous-section', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const blockSections: TemplateSection[] = [
      { id: 'root', sectionKey: 'bloc_clinique', label: 'Bloc clinique', displayOrder: 0, parentSectionKey: null },
      { id: 'child', sectionKey: 'sous_bloc', label: 'Sous-section interdite', displayOrder: 1, parentSectionKey: 'bloc_clinique' },
    ];
    const blockFields: TemplateField[] = [
      ...fields,
      { ...fields[0], id: 'direct', fieldKey: 'direct', label: 'Variable du bloc', section: 'bloc_clinique', displayOrder: 10 },
      { ...fields[0], id: 'child', fieldKey: 'child', label: 'Variable de la sous-section', section: 'sous_bloc', parentSectionKey: 'bloc_clinique', displayOrder: 11 },
    ];
    render(
      <I18nProvider>
        <RuleForm fields={blockFields} sections={blockSections} onSubmit={onSubmit} />
      </I18nProvider>,
    );

    await user.selectOptions(screen.getByLabelText('Type de règle'), 'visibility');
    await user.selectOptions(screen.getByLabelText('Variable de la condition'), 'admission_date');
    await user.selectOptions(screen.getByLabelText('Relation clinique'), 'equals');
    await user.type(screen.getByLabelText('Valeur de la condition'), '2026-01-01');
    await user.selectOptions(screen.getByLabelText('Cible de visibilité'), 'section');
    const target = screen.getByLabelText('Bloc affiché sous condition');
    expect(within(target).getByRole('option', { name: 'Bloc clinique' })).toBeInTheDocument();
    expect(within(target).queryByRole('option', { name: 'Sous-section interdite' })).toBeNull();
    await user.selectOptions(target, 'bloc_clinique');
    await user.click(screen.getByRole('button', { name: 'Ajouter une règle' }));

    expect(onSubmit).toHaveBeenCalledWith({
      if: { field: 'admission_date', operator: 'equals', value: '2026-01-01' },
      then: { section: 'bloc_clinique', operator: 'visible' },
    }, '', 'block');
  });
});

describe('RuleForm — variables calculees (L35 x L32)', () => {
  // Le resultat d'un calcul n'est jamais enregistre : la cle est absente de toutes les fiches.
  const withCalculated: TemplateField[] = [
    ...fields,
    {
      id: 'f5',
      fieldKey: 'sejour_jours',
      label: 'Durée de séjour',
      scope: 'encounter',
      section: 'clinique',
      type: 'integer',
      unit: 'days',
      allowedValues: null,
      required: false,
      minValue: null,
      maxValue: null,
      allowMissingCodes: false,
      displayOrder: 5,
      formula: 'discharge_date - admission_date',
    },
  ];

  function renderWithCalculated(props: { initialRule?: unknown; submitLabel?: string } = {}) {
    const onSubmit = vi.fn();
    render(
      <I18nProvider>
        <RuleForm
          fields={withCalculated}
          onSubmit={onSubmit}
          initialRule={props.initialRule}
          submitLabel={props.submitLabel}
        />
      </I18nProvider>,
    );
    return onSubmit;
  }

  test('absente des comparaisons et des conditions, et l\'ecran dit pourquoi', () => {
    renderWithCalculated();

    for (const label of ['Variable à contrôler', 'Variable de référence']) {
      expect(within(screen.getByLabelText(label)).queryByRole('option', { name: /Durée de séjour/ })).toBeNull();
    }
    // Absente sans un mot, elle serait cherchee puis supposee perdue.
    expect(screen.getByRole('status')).toHaveTextContent('Durée de séjour');
    expect(screen.getByRole('status')).toHaveTextContent(/exclues des conditions, obligations et comparaisons/);
    // Lot 3 : le pourquoi s'ouvre derriere ⓘ.
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'En savoir plus' }));
    expect(screen.getByRole('dialog', { name: 'En savoir plus' })).toHaveTextContent(/jamais se déclencher/);
  });

  test('absente de la condition et de l\'obligation d\'une regle conditionnelle', async () => {
    const user = userEvent.setup();
    renderWithCalculated();

    await user.selectOptions(screen.getByLabelText('Type de règle'), 'conditional');
    expect(within(screen.getByLabelText('Variable de la condition'))
      .queryByRole('option', { name: /Durée de séjour/ })).toBeNull();
    expect(within(screen.getByLabelText('Variable rendue obligatoire'))
      .queryByRole('option', { name: /Durée de séjour/ })).toBeNull();
  });

  test('reste proposee comme variable AFFICHEE sous condition', async () => {
    // Masquer un resultat affiche ne detruit rien : aucune valeur a saisir, aucune fiche a
    // refuser. La seule position ou une variable calculee fonctionne reste ouverte.
    const user = userEvent.setup();
    renderWithCalculated();

    await user.selectOptions(screen.getByLabelText('Type de règle'), 'visibility');
    expect(within(screen.getByLabelText('Variable de la condition'))
      .queryByRole('option', { name: /Durée de séjour/ })).toBeNull();
    expect(within(screen.getByLabelText('Variable affichée sous condition'))
      .getByRole('option', { name: /Durée de séjour/ })).toBeInTheDocument();
  });

  test('une regle HERITEE portant un calcul est expliquee, pas renvoyee muette', async () => {
    // Ecrite avant le garde-fou serveur : le selecteur ne peut plus la representer. L'ecran
    // donne le motif du serveur d'entree, puis refuse l'envoi.
    const user = userEvent.setup();
    const onSubmit = renderWithCalculated({
      initialRule: {
        if: { field: 'sejour_jours', operator: 'less_than', value: 3 },
        then: { field: 'operative_report', operator: 'visible' },
      },
      submitLabel: 'Enregistrer la règle',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Durée de séjour');
    expect(screen.getByRole('alert')).toHaveTextContent(/impossible à piloter par une variable calculée/);

    await user.click(screen.getByRole('button', { name: 'Enregistrer la règle' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('la liste des regles signale une regle heritee qui ne peut pas fonctionner', () => {
    // La phrase se lit parfaitement — c'est precisement pourquoi elle doit etre commentee :
    // sans diagnostic, la liste affirmerait un controle qui n'a jamais lieu.
    render(
      <I18nProvider>
        <RuleSummary
          fields={withCalculated}
          rule={{
            if: { field: 'sejour_jours', operator: 'less_than', value: 3 },
            then: { field: 'operative_report', operator: 'visible' },
          }}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/Compte rendu opératoire est affichée/)).toBeInTheDocument();
    expect(screen.getByText(/impossible à piloter par une variable calculée/)).toBeInTheDocument();
  });
});

// Audit UI mobile, lot 6 (5.13-B) : le regroupement par condition n'est qu'un affichage.
describe('regroupement des règles par condition', () => {
  const liste = (value: unknown[], then: string) => ({ if: { field: 'dx', operator: 'in', value }, then: { field: then, operator: 'visible' } });

  test('une même condition donne la même clé, quel que soit l’ordre des valeurs ; une comparaison n’en a pas', () => {
    expect(ruleConditionKey(liste(['a', 'b'], 'x'))).toBe(ruleConditionKey(liste(['b', 'a'], 'y')));
    expect(ruleConditionKey(liste(['a'], 'x'))).not.toBe(ruleConditionKey(liste(['a', 'b'], 'x')));
    expect(ruleConditionKey({ operator: 'equals', left_field: 'a', right_field: 'b' })).toBeNull();
    expect(ruleConditionKey('illisible')).toBeNull();
  });

  test('la condition se lit avec les libellés d’options, et une règle de groupe ne dit que son effet', () => {
    const choix: TemplateField[] = [
      { ...fields[0], fieldKey: 'chirurgie', label: 'Intervention chirurgicale réalisée', type: 'select', allowedValues: ['oui', 'non'],
        allowedOptions: [{ valueKey: 'oui', label: 'Oui', isActive: true }, { valueKey: 'non', label: 'Non', isActive: true }] },
      { ...fields[0], id: 'voie', fieldKey: 'voie', label: 'Voie d’abord', type: 'text' },
    ];
    const rule = { if: { field: 'chirurgie', operator: 'equals', value: 'oui' }, then: { field: 'voie', operator: 'visible' } };
    expect(ruleConditionText((key) => ({ 'rule.if': 'Si', 'rule.operator.equals': 'est égal à' } as Record<string, string>)[key] ?? key, rule, choix))
      .toBe('Si Intervention chirurgicale réalisée est égal à « Oui »');
    render(<I18nProvider><RuleSummary rule={rule} fields={choix} consequenceOnly /></I18nProvider>);
    expect(screen.getByText('→ Voie d’abord est affichée')).toBeInTheDocument();
  });
});

