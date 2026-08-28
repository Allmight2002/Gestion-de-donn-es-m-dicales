// Tests du validateur de regles JSON controlees (cahier §10).
import { describe, expect, test } from 'vitest';
import { validateRule, parseRule, findVisibilityCycle } from '../src/domain/templateRules';

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
