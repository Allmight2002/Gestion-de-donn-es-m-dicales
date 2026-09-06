// Tests du validateur de regles JSON controlees (cahier §10).
import { describe, expect, test } from 'vitest';
import { validateRule, parseRule, findVisibilityCycle } from '../src/domain/templateRules';
import { diagnosticVisibilityWithdrawalKeys, hiddenFieldKeys, validateValues, withoutHiddenValues } from '../src/domain/validation';
import type { TemplateField, TemplateSection } from '../src/data/types';

describe('validateRule — formes valides', () => {
  test('comparaison (les regles du seed)', () => {
    expect(validateRule({ operator: 'greater_or_equal', left_field: 'discharge_date', right_field: 'admission_date' }))
      .toEqual({ ok: true, kind: 'comparison' });
  });

  test('conditionnelle deces -> death_date required (regle du seed)', () => {
    expect(
      validateRule({
        if: { field: 'outcome', operator: 'equals', value: 'deces' },
        then: { field: 'death_date', operator: 'required' },
      }),
    ).toEqual({ ok: true, kind: 'conditional' });
  });
});

describe('validateRule — rejets', () => {
  test('operateur de comparaison non autorise', () => {
    const r = validateRule({ operator: 'regex_match', left_field: 'a', right_field: 'b' });
    expect(r.ok).toBe(false);
  });

  test('operateur de condition non autorise', () => {
    const r = validateRule({
      if: { field: 'x', operator: 'matches', value: 1 },
      then: { field: 'y', operator: 'required' },
    });
    expect(r.ok).toBe(false);
  });

  test('then.operator different de required', () => {
    const r = validateRule({
      if: { field: 'x', operator: 'equals', value: 1 },
      then: { field: 'y', operator: 'forbidden' },
    });
    expect(r.ok).toBe(false);
  });

  test('champs manquants', () => {
    expect(validateRule({ operator: 'equals', left_field: 'a' }).ok).toBe(false);
  });

  test('non-objet', () => {
    expect(validateRule(42).ok).toBe(false);
    expect(validateRule(null).ok).toBe(false);
  });
});

describe('parseRule', () => {
  test('JSON invalide', () => {
    expect(parseRule('{ pas du json').ok).toBe(false);
  });
  test('JSON valide -> renvoie la valeur', () => {
    const r = parseRule('{"operator":"less_than","left_field":"a","right_field":"b"}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeDefined();
  });
});

describe('regles d\'affichage (L32)', () => {
  const SHOW_IMAGERIE = {
    if: { field: 'imagerie_faite', operator: 'equals', value: true },
    then: { field: 'imagerie_type', operator: 'visible' },
  };

  test('forme acceptee, et reconnue comme un type a part', () => {
    expect(validateRule(SHOW_IMAGERIE)).toEqual({ ok: true, kind: 'visibility' });
  });

  test('la liste blanche du « then » reste fermee', () => {
    const r = validateRule({
      if: { field: 'x', operator: 'equals', value: 1 },
      then: { field: 'y', operator: 'hidden' },
    });
    expect(r.ok).toBe(false);
  });

  test('une variable ne peut pas commander son propre affichage', () => {
    const r = validateRule({
      if: { field: 'x', operator: 'equals', value: 1 },
      then: { field: 'x', operator: 'visible' },
    });
    expect(r.ok).toBe(false);
  });

  test('l\'operateur de la condition reste en liste blanche', () => {
    const r = validateRule({
      if: { field: 'x', operator: 'matches', value: 1 },
      then: { field: 'y', operator: 'visible' },
    });
    expect(r.ok).toBe(false);
  });

  test('une cible section accepte uniquement visible', () => {
    expect(validateRule({
      if: { field: 'diagnostic', operator: 'equals', value: 'x' },
      then: { section: 'bloc', operator: 'visible' },
    })).toEqual({ ok: true, kind: 'visibility' });
    expect(validateRule({
      if: { field: 'diagnostic', operator: 'equals', value: 'x' },
      then: { section: 'bloc', operator: 'required' },
    }).ok).toBe(false);
  });
});

describe('visibilité de bloc — miroir pur du serveur (L52)', () => {
  const field = (fieldKey: string, section: string | null, parentSectionKey?: string | null, type: TemplateField['type'] = 'text'): TemplateField => ({
    id: fieldKey, fieldKey, label: fieldKey, scope: 'patient', section,
    parentSectionKey: parentSectionKey ?? null, type, unit: null, allowedValues: null,
    required: false, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 0,
  });
  const sections: TemplateSection[] = [
    { id: 's-bloc', sectionKey: 'bloc', label: 'Bloc', displayOrder: 0, parentSectionKey: null },
    { id: 's-child', sectionKey: 'sous_bloc', label: 'Sous-bloc', displayOrder: 1, parentSectionKey: 'bloc' },
  ];
  const fields: TemplateField[] = [
    field('diagnostic', null, null, 'terminology'),
    field('bloc_direct', 'bloc'),
    field('bloc_child', 'sous_bloc', 'bloc'),
    field('tronc_commun', null),
    field('after_cascade', null),
  ];
  const blockRule = {
    if: { field: 'diagnostic', operator: 'contains_any', value: ['tuberculose'] },
    then: { section: 'bloc', operator: 'visible' },
  };

  test('masque le direct et toutes les sous-sections, mais jamais le tronc commun', () => {
    const hidden = hiddenFieldKeys([{ rule: blockRule }], {
      diagnostic: { code: 'autre', label: 'Autre' },
      bloc_direct: 'saisi', bloc_child: 'saisi', tronc_commun: 'saisi',
    }, fields, sections);
    expect(hidden).toEqual(new Set(['bloc_direct', 'bloc_child']));
    expect(withoutHiddenValues({ bloc_direct: 'saisi', bloc_child: 'saisi', tronc_commun: 'saisi' }, hidden).removed)
      .toEqual(['bloc_direct', 'bloc_child']);
  });

  test('le point fixe cascade et la complétude ignorent le bloc masqué', () => {
    const rules = [
      { rule: blockRule },
      { rule: { if: { field: 'bloc_direct', operator: 'equals', value: 'oui' }, then: { field: 'after_cascade', operator: 'visible' } } },
    ];
    const hidden = hiddenFieldKeys(rules, {
      diagnostic: { code: 'autre', label: 'Autre' }, bloc_direct: 'oui', bloc_child: 'saisi',
    }, fields, sections);
    expect(hidden).toEqual(new Set(['bloc_direct', 'bloc_child', 'after_cascade']));
    const required = fields.map((f) => f.fieldKey === 'bloc_child' ? { ...f, required: true } : f);
    expect(validateValues(required, {}, true, hidden)).toEqual([]);
  });

  test('un bloc déplié participe au cycle même si la règle le cible par section', () => {
    const cycle = findVisibilityCycle([
      blockRule,
      { if: { field: 'bloc_direct', operator: 'equals', value: 'oui' }, then: { field: 'diagnostic', operator: 'visible' } },
    ], fields, sections);
    expect(cycle).not.toBeNull();
  });

  test('l\'aperçu de retrait d\'un diagnostic compte tout le bloc, sous-sections comprises', () => {
    const blockFields = Array.from({ length: 20 }, (_, index) => field(
      `bloc_${index + 1}`,
      index < 10 ? 'bloc' : 'sous_bloc',
      index < 10 ? null : 'bloc',
    ));
    const previousValues = {
      diagnostic: { code: 'tuberculose', label: 'Tuberculose' },
      ...Object.fromEntries(blockFields.map((item) => [item.fieldKey, `saisie-${item.fieldKey}`])),
    };
    const nextValues = { diagnostic: { code: 'autre', label: 'Autre' } };
    const withdrawal = diagnosticVisibilityWithdrawalKeys(
      [{ rule: blockRule }],
      [fields[0], ...blockFields],
      previousValues,
      nextValues,
      sections,
    );
    const hidden = hiddenFieldKeys([{ rule: blockRule }], nextValues, [fields[0], ...blockFields], sections);

    expect(withdrawal).toHaveProperty('size', 20);
    expect(withoutHiddenValues(previousValues, hidden).removed).toHaveLength(20);
  });
});

describe('findVisibilityCycle', () => {
  const show = (driver: string, target: string) => ({
    if: { field: driver, operator: 'equals', value: 'x' },
    then: { field: target, operator: 'visible' },
  });

  test('une chaine sans boucle passe', () => {
    expect(findVisibilityCycle([show('a', 'b'), show('b', 'c'), show('b', 'd')])).toBeNull();
  });

  test('A masque par B et B masque par A : cycle detecte', () => {
    expect(findVisibilityCycle([show('a', 'b'), show('b', 'a')])).not.toBeNull();
  });

  test('cycle indirect A -> B -> C -> A', () => {
    const cycle = findVisibilityCycle([show('a', 'b'), show('b', 'c'), show('c', 'a')]);
    expect(cycle).not.toBeNull();
    // Le chemin nomme les variables fautives : sinon le message ne sert a rien.
    expect(new Set(cycle!)).toEqual(new Set(['a', 'b', 'c']));
  });

  test('les regles d\'une autre forme sont ignorees', () => {
    expect(findVisibilityCycle([
      { operator: 'less_than', left_field: 'a', right_field: 'b' },
      { if: { field: 'a', operator: 'equals', value: 1 }, then: { field: 'b', operator: 'required' } },
    ])).toBeNull();
  });
});
