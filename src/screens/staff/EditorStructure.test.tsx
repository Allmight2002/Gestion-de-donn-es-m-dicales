// @vitest-environment jsdom
// L67 — le sommaire distingue un bloc repetable d'un bloc ordinaire. Les deux ne se
// saisissent pas de la meme facon : l'un se remplit champ par champ, l'autre ligne par
// ligne. Une structure qui ne le dit pas laisse deviner.
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TemplateField, TemplateSection } from '../../data/types';
import { EditorStructure, editorGroups } from './EditorStructure';

const sections: TemplateSection[] = [
  { id: 's1', sectionKey: 'lesions', label: 'Lésions', displayOrder: 0, parentSectionKey: null, isRepeatable: true },
  { id: 's2', sectionKey: 'examen', label: 'Examen', displayOrder: 1, parentSectionKey: null },
];

const fields: TemplateField[] = [
  {
    id: 'f1', fieldKey: 'niveau', label: 'Niveau', section: 'lesions', scope: 'encounter',
    type: 'text', unit: null, allowedValues: null, required: false, minValue: null,
    maxValue: null, allowMissingCodes: false, displayOrder: 0,
  },
];

const identity = ((key: string) => key) as unknown as Parameters<typeof editorGroups>[3];

function renderStructure(activeKey = '') {
  const groups = editorGroups(fields, sections, undefined, identity);
  render(
    <I18nProvider>
      <EditorStructure
        groups={groups} activeKey={activeKey} onSelect={vi.fn()}
        displayedFields={fields} allFields={fields} editable busy={false}
        canReorder onOpen={vi.fn()} onMove={vi.fn()} onStep={vi.fn()} onDelete={vi.fn()}
        onDrop={vi.fn()} onRules={vi.fn()} ruleCount={() => 0} context={null}
      />
    </I18nProvider>,
  );
  return groups;
}

describe('EditorStructure — marqueur de bloc repetable (L67)', () => {
  test('editorGroups reporte le caractere repetable de la section', () => {
    const groups = editorGroups(fields, sections, undefined, identity);
    expect(groups.find((group) => group.key === 'lesions')?.repeatable).toBe(true);
    expect(groups.find((group) => group.key === 'examen')?.repeatable).toBe(false);
  });

  test('le marqueur est dans le NOM ACCESSIBLE du bloc, pas seulement dans sa couleur', () => {
    renderStructure();
    expect(screen.getByRole('button', { name: /Lésions .*Répétable/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Examen.*Répétable/ })).toBeNull();
  });

  test('le bloc selectionne annonce sa forme de saisie', () => {
    renderStructure('lesions');
    expect(screen.getByText('Saisie en tableau, une ligne par occurrence.')).toBeInTheDocument();
  });

  test('un bloc ordinaire n annonce rien de tel', () => {
    renderStructure('examen');
    expect(screen.queryByText('Saisie en tableau, une ligne par occurrence.')).toBeNull();
  });
});

// L72b — un groupe repetable peut etre une sous-section : son marqueur apparait dans l'arbre
// de SON bloc, a son rang parmi les sous-sections, et non comme un bloc de plus.
describe('EditorStructure — groupe repetable en sous-section (L72b)', () => {
  const nested: TemplateSection[] = [
    { id: 'a', sectionKey: 'trauma', label: 'Traumatisme', displayOrder: 0, parentSectionKey: null },
    { id: 'a1', sectionKey: 'bilan', label: 'Bilan', displayOrder: 1, parentSectionKey: 'trauma' },
    { id: 'g1', sectionKey: 'lesions', label: 'Lésions', displayOrder: 2, parentSectionKey: 'trauma', isRepeatable: true },
    { id: 'a2', sectionKey: 'suites', label: 'Suites', displayOrder: 3, parentSectionKey: 'trauma' },
  ];
  const nestedField = (id: string, fieldKey: string, section: string, scope: 'patient' | 'encounter'): TemplateField => ({
    id, fieldKey, label: fieldKey, section, scope, type: 'text', unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
  });
  const nestedFields = [
    nestedField('f1', 'mecanisme', 'bilan', 'patient'),
    nestedField('f2', 'niveau', 'lesions', 'encounter'),
    nestedField('f3', 'sequelles', 'suites', 'patient'),
  ];

  function renderNested(activeKey = '') {
    const groups = editorGroups(nestedFields, nested, undefined, identity);
    render(
      <I18nProvider>
        <EditorStructure
          groups={groups} activeKey={activeKey} onSelect={vi.fn()}
          displayedFields={nestedFields} allFields={nestedFields} editable busy={false}
          canReorder onOpen={vi.fn()} onMove={vi.fn()} onStep={vi.fn()} onDelete={vi.fn()}
          onDrop={vi.fn()} onRules={vi.fn()} ruleCount={() => 0} context={null}
        />
      </I18nProvider>,
    );
    return groups;
  }

  test('editorGroups rattache le groupe a son bloc, a son rang, avec son marqueur', () => {
    const groups = editorGroups(nestedFields, nested, undefined, identity)
      .filter((group) => !group.common);
    expect(groups.map((group) => group.key)).toEqual(['trauma', 'bilan', 'lesions', 'suites']);
    const lesions = groups.find((group) => group.key === 'lesions');
    expect(lesions?.parentKey).toBe('trauma');
    expect(lesions?.repeatable).toBe(true);
    expect(groups.find((group) => group.key === 'bilan')?.repeatable).toBe(false);
  });

  test('le sommaire marque le groupe enfant sous son bloc, et lui seul', () => {
    renderNested();
    const outline = screen.getByRole('navigation', { name: 'Sommaire du formulaire' });
    const names = within(outline).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent);
    const trauma = names.findIndex((name) => name?.startsWith('Traumatisme'));
    const lesions = names.findIndex((name) => /^Lésions .*Répétable/.test(name ?? ''));
    expect(trauma).toBeGreaterThanOrEqual(0);
    expect(lesions).toBeGreaterThan(trauma);
    expect(names.filter((name) => /Répétable/.test(name ?? ''))).toHaveLength(1);
  });

  test('les sous-sections du bloc selectionne distinguent le groupe', () => {
    renderNested('trauma');
    const subsections = screen.getByLabelText('Sous-sections');
    const chips = within(subsections).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent?.startsWith('Lésions') ? chip.getAttribute('aria-label') : chip.textContent))
      .toEqual(['Bilan (1)', 'Lésions · Répétable · 1 variable(s)', 'Suites (1)']);
  });
});
