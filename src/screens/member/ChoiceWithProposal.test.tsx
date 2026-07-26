// @vitest-environment jsdom
// F5 : la valeur hors liste ne doit JAMAIS entrer dans le champ a liste controlee.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import { EncounterFields } from './EncounterFields';
import type { TemplateField } from '../../data/types';

function field(over: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'label' | 'type'>): TemplateField {
  return {
    id: over.fieldKey,
    scope: 'encounter',
    section: 'clinique',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    displayOrder: 0,
    ...over,
  } as TemplateField;
}

const diagnostic = field({
  fieldKey: 'diagnostic',
  label: 'Diagnostic',
  type: 'select',
  allowedValues: ['Paludisme', 'Traumatisme'],
});
const companion = field({ fieldKey: 'diagnostic_autre', label: 'Diagnostic — valeur proposée', type: 'text' });

function renderFields(values: Record<string, unknown> = {}, onChange = vi.fn()) {
  render(
    <I18nProvider>
      <EncounterFields fields={[diagnostic, companion]} values={values} onChange={onChange} />
    </I18nProvider>,
  );
  return onChange;
}

describe('EncounterFields — soupape (F5)', () => {
  test('le champ compagnon n est pas rendu comme un champ autonome', () => {
    renderFields();
    expect(screen.queryByLabelText('Diagnostic — valeur proposée')).toBeNull();
    expect(screen.getByLabelText('Diagnostic')).toBeInTheDocument();
  });

  test('la saisie libre reste masquee tant qu on ne la demande pas', () => {
    renderFields();
    expect(screen.queryByText('Décrivez la valeur manquante :')).toBeNull();
  });

  test('demander la soupape vide le champ a liste controlee', async () => {
    const onChange = renderFields({ diagnostic: 'Paludisme' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Autre — absent de la liste' }));
    expect(onChange).toHaveBeenCalledWith('diagnostic', null);
  });

  test('le texte saisi part dans le champ compagnon, jamais dans la liste', async () => {
    const onChange = renderFields();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Autre — absent de la liste' }));
    await userEvent.type(screen.getByRole('textbox'), 'D');

    expect(onChange).toHaveBeenCalledWith('diagnostic_autre', 'D');
    expect(onChange).not.toHaveBeenCalledWith('diagnostic', 'D');
  });

  test('un avertissement annonce que la fiche restera a completer', async () => {
    renderFields();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Autre — absent de la liste' }));
    expect(screen.getByRole('status')).toHaveTextContent(/restera à compléter/);
  });

  test('une proposition deja enregistree est relue sans avoir a redemander la soupape', () => {
    renderFields({ diagnostic_autre: 'Morsure de serpent' });
    expect(screen.getByDisplayValue('Morsure de serpent')).toBeInTheDocument();
  });
});
