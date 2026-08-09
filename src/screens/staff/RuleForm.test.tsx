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
