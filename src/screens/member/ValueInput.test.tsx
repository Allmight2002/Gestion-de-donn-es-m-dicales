// @vitest-environment jsdom
// L33 : le selecteur de valeur manquante ne propose que les raisons qui ont un sens pour LA
// variable en cours. Proposer « non realise » sur un sexe est le defaut que ce lot corrige.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { ValueInput } from './ValueInput';
import type { TemplateField } from '../../data/types';

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey'>): TemplateField {
  return {
    id: p.fieldKey, label: p.fieldKey, scope: 'encounter', section: 'clinique', type: 'text',
    unit: null, allowedValues: null, required: false, minValue: null, maxValue: null,
    allowMissingCodes: true, displayOrder: 0, ...p,
  };
}

function renderInput(f: TemplateField, value: unknown = null) {
  render(
    <I18nProvider>
      <ValueInput field={f} value={value} onChange={vi.fn()} />
    </I18nProvider>,
  );
  return () => screen.queryByLabelText(`${f.label} — valeur manquante`) as HTMLSelectElement | null;
}

const optionsOf = (select: HTMLSelectElement) => [...select.options].map((o) => o.value);

describe('ValueInput — raisons proposees par variable (L33)', () => {
  test('seules les raisons de la variable sont proposees', () => {
    const get = renderInput(field({ fieldKey: 'examen', missingReasons: ['refus', 'non_documente'] }));
    expect(optionsOf(get()!)).toEqual(['value', 'refus', 'non_documente']);
  });

  test('« refus » se propose sans que « non fait » soit impose', () => {
    const get = renderInput(field({ fieldKey: 'serologie', missingReasons: ['refus'] }));
    const options = optionsOf(get()!);
    expect(options).toContain('refus');
    expect(options).not.toContain('non_fait');
  });

  test('aucune raison -> aucun selecteur', () => {
    const get = renderInput(field({ fieldKey: 'sexe', allowMissingCodes: false, missingReasons: [] }));
    expect(get()).toBeNull();
  });

  test('un instantane hors-ligne ANTERIEUR au lot retombe sur les trois codes historiques', () => {
    // `missingReasons` absente : c'est le cas d'une copie telechargee avant L33.
    const get = renderInput(field({ fieldKey: 'ancien', allowMissingCodes: true }));
    expect(optionsOf(get()!)).toEqual(['value', 'non_fait', 'inconnu', 'non_applicable']);
  });

  test('une fiche portant une raison que la variable ne propose plus reste lisible et modifiable', () => {
    // Sinon le selecteur s'ouvre vide : la fiche devient illisible, puis inmodifiable au
    // premier enregistrement.
    const get = renderInput(
      field({ fieldKey: 'histoire', missingReasons: ['refus'] }),
      { __missing__: 'non_fait' },
    );
    expect(screen.getByText('Non fait', { selector: 'span' })).toBeInTheDocument();
    expect(optionsOf(get()!)).toContain('non_fait');
    expect(get()!.value).toBe('non_fait');
  });
});
