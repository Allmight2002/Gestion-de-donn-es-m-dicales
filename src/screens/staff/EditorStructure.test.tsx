// @vitest-environment jsdom
// L67 — le sommaire distingue un bloc repetable d'un bloc ordinaire. Les deux ne se
// saisissent pas de la meme facon : l'un se remplit champ par champ, l'autre ligne par
// ligne. Une structure qui ne le dit pas laisse deviner.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
