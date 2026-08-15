// @vitest-environment jsdom
// L30 : une liste controlee stocke le CODE de l'option, et n'affiche que son libelle.
//
// Deux exigences se tiennent en tension et sont testees ensemble ici :
//   * une option DESACTIVEE ne doit plus etre proposee a la saisie ;
//   * une fiche qui en porte une doit rester lisible ET modifiable -- si le menu la
//     laissait tomber, la valeur serait effacee au premier enregistrement.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldInput } from './FieldInput';
import type { TemplateField } from '../../data/types';

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'type'>): TemplateField {
  return {
    id: p.fieldKey, label: p.fieldKey, scope: 'encounter', section: 'clinique',
    unit: null, allowedValues: null, required: false, minValue: null, maxValue: null,
    allowMissingCodes: true, displayOrder: 0, ...p,
  };
}

const EVOLUTION = field({
  fieldKey: 'evolution',
  type: 'select',
  label: 'Évolution',
  allowedValues: ['gueri', 'deces'],
  allowedOptions: [
    { value_key: 'gueri', label: 'Guéri', is_active: true },
    { value_key: 'deces', label: 'Décès', is_active: false },
  ],
});

const renderInput = (f: TemplateField, value: unknown, onChange = vi.fn()) => {
  render(<FieldInput field={f} value={value} onChange={onChange} />);
  return onChange;
};

const optionsOf = (select: HTMLSelectElement) =>
  [...select.options].map((o) => ({ value: o.value, text: o.textContent }));

describe('FieldInput — liste a code stable (L30)', () => {
  test('le menu montre les libelles et enregistre les codes', async () => {
    const onChange = renderInput(EVOLUTION, null);
    const select = screen.getByLabelText('Évolution') as HTMLSelectElement;
    expect(optionsOf(select)).toEqual([
      { value: '', text: '—' },
      { value: 'gueri', text: 'Guéri' },
    ]);
    await userEvent.selectOptions(select, 'gueri');
    expect(onChange).toHaveBeenCalledWith('gueri');
  });

  test('une option desactivee n est plus proposee...', () => {
    renderInput(EVOLUTION, null);
    const select = screen.getByLabelText('Évolution') as HTMLSelectElement;
    expect(optionsOf(select).some((o) => o.value === 'deces')).toBe(false);
  });

  test('... mais reste offerte a la fiche qui la porte deja, avec son libelle', () => {
    renderInput(EVOLUTION, 'deces');
    const select = screen.getByLabelText('Évolution') as HTMLSelectElement;
    expect(select.value).toBe('deces');
    expect(optionsOf(select)).toContainEqual({ value: 'deces', text: 'Décès' });
  });

  test('une valeur hors liste est conservee et montree telle quelle', () => {
    // Sequelle d'un renommage anterieur au lot : ni effacee, ni remplacee en silence.
    renderInput(EVOLUTION, 'hematome');
    const select = screen.getByLabelText('Évolution') as HTMLSelectElement;
    expect(select.value).toBe('hematome');
    expect(optionsOf(select)).toContainEqual({ value: 'hematome', text: 'hematome' });
  });

  test('une variable anterieure au lot (que des cles) se comporte comme avant', () => {
    renderInput(field({ fieldKey: 'sexe', type: 'select', label: 'Sexe', allowedValues: ['M', 'F'] }), 'M');
    const select = screen.getByLabelText('Sexe') as HTMLSelectElement;
    expect(optionsOf(select)).toEqual([
      { value: '', text: '—' },
      { value: 'M', text: 'M' },
      { value: 'F', text: 'F' },
    ]);
  });
});

describe('FieldInput — liste multiple a code stable (L30)', () => {
  const SIGNES = field({
    fieldKey: 'signes',
    type: 'multiselect',
    label: 'Signes',
    allowedValues: ['fievre', 'toux'],
    allowedOptions: [
      { value_key: 'fievre', label: 'Fièvre', is_active: true },
      { value_key: 'toux', label: 'Toux', is_active: false },
    ],
  });

  test('coche par libelle, enregistre par code', async () => {
    const onChange = renderInput(SIGNES, []);
    await userEvent.click(screen.getByLabelText('Fièvre'));
    expect(onChange).toHaveBeenCalledWith(['fievre']);
  });

  test('une option desactivee sort de la saisie mais reste decochable si elle est portee', async () => {
    const onChange = renderInput(SIGNES, ['toux']);
    const coche = screen.getByLabelText('Toux') as HTMLInputElement;
    expect(coche.checked).toBe(true);
    await userEvent.click(coche);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  test('une valeur hors liste reste cochee et nommee telle quelle', () => {
    renderInput(SIGNES, ['dyspnee']);
    expect((screen.getByLabelText('dyspnee') as HTMLInputElement).checked).toBe(true);
  });
});
