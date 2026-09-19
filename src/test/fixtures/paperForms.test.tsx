// PAP-0 — invariants des trois cas de la campagne « formulaire papier ».
//
// Ce test ne mesure rien : il garantit que PAP-1 a PAP-4 pourront reutiliser EXACTEMENT les
// cas mesures par PAP-0. Un cas qui deriverait (cle dupliquee, section fantome, regle
// pendante, taille qui change) invaliderait silencieusement la comparaison a la baseline.

import { describe, expect, it } from 'vitest';
import {
  PAPER_FORM_CASES,
  paperFormCase,
  paperLargeCase,
  paperMediumCase,
  paperShortCase,
  type PaperFormCase,
} from './paperForms';
import {
  EDITOR_REGISTRY_FIELD_COUNT,
  EDITOR_REGISTRY_RULE_COUNT,
  EDITOR_REGISTRY_SECTION_COUNT,
} from './editorRegistry';

/** Cles de variables citees par une regle, quelle que soit sa forme. */
function referencedFieldKeys(rule: unknown): string[] {
  const keys: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    for (const property of ['field', 'left_field', 'right_field']) {
      if (typeof record[property] === 'string') keys.push(record[property] as string);
    }
    Object.values(record).forEach(walk);
  };
  walk(rule);
  return keys;
}

function referencedSectionKeys(rule: unknown): string[] {
  const keys: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.section === 'string') keys.push(record.section);
    Object.values(record).forEach(walk);
  };
  walk(rule);
  return keys;
}

describe('cas de formulaire papier (PAP-0)', () => {
  it('expose les trois cas de la campagne dans l’ordre court -> moyen -> volumineux', () => {
    expect(PAPER_FORM_CASES.map((entry) => entry.key)).toEqual(['court', 'moyen', 'volumineux']);
    expect(paperFormCase('court')).toBe(paperShortCase);
    expect(paperFormCase('moyen')).toBe(paperMediumCase);
    expect(paperFormCase('volumineux')).toBe(paperLargeCase);
  });

  it('classe les trois cas par taille croissante', () => {
    expect(paperShortCase.fields.length).toBeLessThan(paperMediumCase.fields.length);
    expect(paperMediumCase.fields.length).toBeLessThan(paperLargeCase.fields.length);
  });

  it('retient un cas volumineux au moins aussi grand que la cible PAP-0', () => {
    expect(paperLargeCase.fields).toHaveLength(EDITOR_REGISTRY_FIELD_COUNT);
    expect(paperLargeCase.sections).toHaveLength(EDITOR_REGISTRY_SECTION_COUNT);
    expect(paperLargeCase.rules).toHaveLength(EDITOR_REGISTRY_RULE_COUNT);
    // La cible du lot : au moins 216 variables, 21 sections et plus de 20 regles.
    expect(paperLargeCase.fields.length).toBeGreaterThanOrEqual(216);
    expect(paperLargeCase.sections.length).toBeGreaterThanOrEqual(21);
    expect(paperLargeCase.rules.length).toBeGreaterThan(20);
  });

  // Les tailles sont figees : une fixture qui grossit sans que la baseline soit refaite
  // rendrait tout gain de PAP-1 a PAP-4 incomparable.
  it.each([
    ['court', paperShortCase, 18, 3, 2],
    ['moyen', paperMediumCase, 77, 10, 9],
  ] as const)('fige la taille du cas %s', (_name, entry, fields, sections, rules) => {
    expect(entry.fields).toHaveLength(fields);
    expect(entry.sections).toHaveLength(sections);
    expect(entry.rules).toHaveLength(rules);
  });

  describe.each(PAPER_FORM_CASES.map((entry) => [entry.key, entry] as const))('cas %s', (_key, entry: PaperFormCase) => {
    it('n’a ni cle de variable ni identifiant en double', () => {
      const keys = entry.fields.map((item) => item.fieldKey);
      expect(new Set(keys).size).toBe(keys.length);
      const ids = entry.fields.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      const sectionKeys = entry.sections.map((section) => section.sectionKey);
      expect(new Set(sectionKeys).size).toBe(sectionKeys.length);
      const ruleIds = entry.rules.map((rule) => rule.id);
      expect(new Set(ruleIds).size).toBe(ruleIds.length);
    });

    it('ne rattache aucune variable a une section inexistante', () => {
      const known = new Set(entry.sections.map((section) => section.sectionKey));
      const orphans = entry.fields
        .filter((item) => item.section !== null && !known.has(item.section))
        .map((item) => item.fieldKey);
      expect(orphans).toEqual([]);
    });

    it('ne declare aucun parent de section inexistant', () => {
      const known = new Set(entry.sections.map((section) => section.sectionKey));
      const orphans = entry.sections
        .filter((section) => section.parentSectionKey && !known.has(section.parentSectionKey))
        .map((section) => section.sectionKey);
      expect(orphans).toEqual([]);
    });

    it('garde au moins une variable detachee pour la zone de secours', () => {
      expect(entry.fields.some((item) => item.section === null)).toBe(true);
    });

    it('ne cite dans ses regles que des variables et des sections du cas', () => {
      const fieldKeys = new Set(entry.fields.map((item) => item.fieldKey));
      const sectionKeys = new Set(entry.sections.map((section) => section.sectionKey));
      for (const rule of entry.rules) {
        for (const key of referencedFieldKeys(rule.rule)) expect(fieldKeys.has(key)).toBe(true);
        for (const key of referencedSectionKeys(rule.rule)) expect(sectionKeys.has(key)).toBe(true);
      }
    });

    it('annonce un nombre de variables coherent avec la version', () => {
      expect(entry.version.fieldCount).toBe(entry.fields.length);
    });

    it('ne propose aucune valeur par defaut : le formulaire imprime reste vierge', () => {
      expect(entry.fields.filter((item) => item.defaultValue)).toEqual([]);
    });

    it('n’utilise que des variables du cas dans les rubriques communes', () => {
      const fieldKeys = new Set(entry.fields.map((item) => item.fieldKey));
      for (const group of entry.version.commonLayout?.groups ?? []) {
        for (const key of group.fields) expect(fieldKeys.has(key)).toBe(true);
      }
    });
  });
});
