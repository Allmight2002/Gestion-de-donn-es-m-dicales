// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TemplateField } from '../../data/types';
import { RuleForm, RuleSummary } from './RuleForm';

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
    expect(within(leftField).getByRole('option', { name: 'Date — Patient — patient_date' })).toBeInTheDocument();
    expect(within(leftField).getByRole('option', { name: 'Date — Visite — visit_date' })).toBeInTheDocument();
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
    expect(screen.getByText(/retirée à l’enregistrement/)).toBeInTheDocument();
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
});
