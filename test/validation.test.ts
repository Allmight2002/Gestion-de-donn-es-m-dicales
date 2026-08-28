// Tests du moteur de validation de saisie (cahier §10, critères 3 et 4).
import { describe, expect, test } from 'vitest';
import {
  validateField,
  validateValues,
  evaluateRules,
  makeMissing,
  isMissing,
  missingCodeOf,
  allowedMissingReasons,
  hiddenFieldKeys,
  withoutHiddenValues,
} from '../src/domain/validation';
import type { TemplateField } from '../src/data/types';

function field(p: Partial<TemplateField> & Pick<TemplateField, 'fieldKey' | 'type'>): TemplateField {
  return {
    id: p.fieldKey,
    label: p.fieldKey,
    scope: 'encounter',
    section: 'clinique',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: true,
    displayOrder: 0,
    ...p,
  };
}

describe('valeurs manquantes codifiees (distinctes du vide)', () => {
  test('helpers', () => {
    const m = makeMissing('inconnu');
    expect(isMissing(m)).toBe(true);
    expect(missingCodeOf(m)).toBe('inconnu');
    expect(isMissing('')).toBe(false);
    expect(isMissing(5)).toBe(false);
  });

  test('un champ obligatoire vide -> erreur ; un code manquant satisfait la presence', () => {
    const f = field({ fieldKey: 'x', type: 'text', required: true });
    expect(validateField(f, '')).toMatch(/obligatoire/i);
    expect(validateField(f, makeMissing('non_fait'))).toBeNull();
  });

  test('code manquant interdit si allow_missing_codes=false', () => {
    const f = field({ fieldKey: 'x', type: 'text', allowMissingCodes: false });
    expect(validateField(f, makeMissing('inconnu'))).toMatch(/non autoris/i);
  });
});

describe('controles par champ (bornes, listes)', () => {
  const gcs = field({ fieldKey: 'glasgow_score', type: 'integer', required: true, minValue: 3, maxValue: 15 });
  test('hors bornes -> erreur', () => {
    expect(validateField(gcs, 2)).toMatch(/minimale/i);
    expect(validateField(gcs, 20)).toMatch(/maximale/i);
    expect(validateField(gcs, 10)).toBeNull();
  });
  test('valeur hors liste -> erreur', () => {
    const sel = field({ fieldKey: 'outcome', type: 'select', allowedValues: ['gueri', 'deces'] });
    expect(validateField(sel, 'autre')).toMatch(/liste/i);
    expect(validateField(sel, 'deces')).toBeNull();
  });
  test('dates et date-heures strictes -> format ISO reel obligatoire', () => {
    const date = field({ fieldKey: 'admission_date', type: 'date' });
    expect(validateField(date, '2024-02-29')).toBeNull();
    expect(validateField(date, '2024-2-29')).toMatch(/date/i);
    expect(validateField(date, '2024-02-30')).toMatch(/date/i);
    expect(validateField(date, '2024-02-29T10:15')).toMatch(/date/i);

    const datetime = field({ fieldKey: 'triage_time', type: 'datetime' });
    expect(validateField(datetime, '2024-02-29T10:15')).toBeNull();
    expect(validateField(datetime, '2024-02-29T10:15:30Z')).toBeNull();
    expect(validateField(datetime, '2024-02-29T10:15+01:00')).toBeNull();
    expect(validateField(datetime, '2024-02-30T10:15')).toMatch(/date/i);
    expect(validateField(datetime, '2024-02-29 10:15')).toMatch(/date/i);
    expect(validateField(datetime, '2024-02-29T24:00')).toMatch(/date/i);
  });
  test('validateValues agrege les erreurs', () => {
    const errs = validateValues([gcs], { glasgow_score: 99 });
    expect(errs).toHaveLength(1);
    expect(errs[0].fieldKey).toBe('glasgow_score');
  });
});

describe('regles de coherence (§10, critere 4)', () => {
  const cmp = { rule: { operator: 'greater_or_equal', left_field: 'discharge_date', right_field: 'admission_date' }, message: 'sortie >= admission', severity: 'block' as const };
  const cond = { rule: { if: { field: 'outcome', operator: 'equals', value: 'deces' }, then: { field: 'death_date', operator: 'required' } }, message: 'deces -> date requise', severity: 'block' as const };

  test('comparaison de dates : sortie < admission -> bloquant', () => {
    expect(evaluateRules([cmp], { admission_date: '2024-01-05', discharge_date: '2024-01-01' }).blocking).toContain('sortie >= admission');
    expect(evaluateRules([cmp], { admission_date: '2024-01-05', discharge_date: '2024-01-10' }).blocking).toHaveLength(0);
  });

  test('regle inapplicable si un operande absent', () => {
    expect(evaluateRules([cmp], { admission_date: '2024-01-05' }).blocking).toHaveLength(0);
  });

  test('conditionnelle deces -> death_date requise', () => {
    expect(evaluateRules([cond], { outcome: 'deces' }).blocking).toContain('deces -> date requise');
    expect(evaluateRules([cond], { outcome: 'deces', death_date: '2024-01-06' }).blocking).toHaveLength(0);
    expect(evaluateRules([cond], { outcome: 'gueri' }).blocking).toHaveLength(0);
  });

  test('severite warn -> avertissement, pas bloquant', () => {
    const warnRule = { ...cmp, severity: 'warn' as const };
    const res = evaluateRules([warnRule], { admission_date: '2024-01-05', discharge_date: '2024-01-01' });
    expect(res.blocking).toHaveLength(0);
    expect(res.warnings).toContain('sortie >= admission');
  });
});

// L33 : la liste des raisons cesse d'etre la meme pour toutes les variables.
describe('raisons de valeur manquante par variable (L33)', () => {
  test('une raison hors de la liste de la variable est refusee', () => {
    const f = field({ fieldKey: 'serologie', type: 'text', missingReasons: ['refus'] });
    expect(validateField(f, makeMissing('refus'))).toBeNull();
    expect(validateField(f, makeMissing('non_fait'))).toMatch(/raison.*non autoris/i);
  });

  test('liste vide -> aucune valeur manquante, message inchange', () => {
    const f = field({ fieldKey: 'sexe', type: 'text', allowMissingCodes: false, missingReasons: [] });
    expect(validateField(f, makeMissing('inconnu'))).toMatch(/valeur manquante non autoris/i);
  });

  test('les deux nouvelles raisons satisfont la presence d un champ obligatoire', () => {
    const f = field({ fieldKey: 'x', type: 'text', required: true, missingReasons: ['refus', 'non_documente'] });
    expect(validateField(f, makeMissing('refus'))).toBeNull();
    expect(validateField(f, makeMissing('non_documente'))).toBeNull();
  });

  test('sans liste (instantane anterieur au lot) -> repli sur les trois codes historiques', () => {
    const ancien = field({ fieldKey: 'ancien', type: 'text', allowMissingCodes: true, missingReasons: undefined });
    expect(allowedMissingReasons(ancien)).toEqual(['non_fait', 'inconnu', 'non_applicable']);
    expect(validateField(ancien, makeMissing('non_fait'))).toBeNull();
    // Une raison du lot n'est PAS retro-ajoutee a une variable qui ne la connaissait pas.
    expect(validateField(ancien, makeMissing('refus'))).toMatch(/non autoris/i);
  });

  test('l ordre canonique est impose, quel que soit l ordre de saisie', () => {
    const f = field({ fieldKey: 'x', type: 'text', missingReasons: ['non_documente', 'non_fait'] });
    expect(allowedMissingReasons(f)).toEqual(['non_fait', 'non_documente']);
  });
});

// --- L32 : affichage conditionnel --------------------------------------------

describe('hiddenFieldKeys (L32)', () => {
  const show = (driver: string, target: string, value: unknown = true) => ({
    rule: {
      if: { field: driver, operator: 'equals', value },
      then: { field: target, operator: 'visible' },
    },
  });

  test('sans regle d\'affichage, rien n\'est masque', () => {
    expect([...hiddenFieldKeys([], { a: 1 })]).toEqual([]);
  });

  test('condition non verifiable -> masque (formulaire vierge)', () => {
    expect([...hiddenFieldKeys([show('imagerie_faite', 'imagerie_type')], {})]).toEqual(['imagerie_type']);
  });

  test('condition fausse -> masque ; condition vraie -> affiche', () => {
    const rules = [show('imagerie_faite', 'imagerie_type')];
    expect(hiddenFieldKeys(rules, { imagerie_faite: false }).has('imagerie_type')).toBe(true);
    expect(hiddenFieldKeys(rules, { imagerie_faite: true }).has('imagerie_type')).toBe(false);
  });

  test('cascade : une variable pilote masquee est lue comme absente', () => {
    const rules = [show('imagerie_faite', 'imagerie_type'), show('imagerie_type', 'imagerie_date', 'scanner')];
    // `imagerie_type` porte une valeur mais reste masque : la date ne doit pas reapparaitre.
    const hidden = hiddenFieldKeys(rules, { imagerie_type: 'scanner' });
    expect(hidden.has('imagerie_type')).toBe(true);
    expect(hidden.has('imagerie_date')).toBe(true);
  });

  test('plusieurs regles sur une meme variable se cumulent en ET', () => {
    const rules = [show('a', 'cible'), show('b', 'cible')];
    expect(hiddenFieldKeys(rules, { a: true }).has('cible')).toBe(true);
    expect(hiddenFieldKeys(rules, { a: true, b: true }).has('cible')).toBe(false);
  });

  test('une valeur manquante codifiee ne verifie pas une condition', () => {
    const rules = [show('imagerie_faite', 'imagerie_type')];
    expect(hiddenFieldKeys(rules, { imagerie_faite: makeMissing('inconnu') }).has('imagerie_type')).toBe(true);
  });

  test('un cycle ne fait pas boucler l\'evaluation', () => {
    // Refuse a l'enregistrement de la regle ; ici on verifie seulement que la saisie
    // n'a pas a s'en defendre par une boucle infinie.
    const hidden = hiddenFieldKeys([show('a', 'b'), show('b', 'a')], {});
    expect([...hidden].sort()).toEqual(['a', 'b']);
  });
});

describe('visibilite d\'abord, obligation ensuite (L32)', () => {
  const requis = field({ fieldKey: 'imagerie_type', type: 'text', required: true });

  test('un champ requis MASQUE n\'est pas reclame', () => {
    expect(validateValues([requis], {}, true, new Set(['imagerie_type']))).toEqual([]);
  });

  test('le meme champ redevient obligatoire une fois affiche', () => {
    expect(validateValues([requis], {}, true)).toEqual([
      { fieldKey: 'imagerie_type', message: 'Champ obligatoire' },
    ]);
  });

  test('une regle « obligatoire sous condition » visant un champ masque ne bloque pas', () => {
    const rules = [{
      rule: { if: { field: 'poids', operator: 'greater_than', value: 0 }, then: { field: 'imagerie_date', operator: 'required' } },
      message: 'Date d imagerie requise',
      severity: 'block' as const,
    }];
    expect(evaluateRules(rules, { poids: 70 }).blocking).toEqual(['Date d imagerie requise']);
    expect(evaluateRules(rules, { poids: 70 }, new Set(['imagerie_date'])).blocking).toEqual([]);
  });

  test('une regle d\'affichage ne bloque jamais, meme enregistree en « bloquant »', () => {
    const rules = [{
      rule: { if: { field: 'a', operator: 'equals', value: true }, then: { field: 'b', operator: 'visible' } },
      message: null,
      severity: 'block' as const,
    }];
    expect(evaluateRules(rules, {}).blocking).toEqual([]);
  });

  test('une comparaison portant sur un champ masque devient inapplicable', () => {
    const rules = [{
      rule: { operator: 'greater_or_equal', left_field: 'sortie', right_field: 'admission' },
      message: 'Sortie avant admission',
      severity: 'block' as const,
    }];
    const values = { sortie: '2026-01-01', admission: '2026-02-01' };
    expect(evaluateRules(rules, values).blocking).toEqual(['Sortie avant admission']);
    expect(evaluateRules(rules, values, new Set(['sortie'])).blocking).toEqual([]);
  });
});

describe('withoutHiddenValues (L32)', () => {
  test('retire les valeurs masquees et NOMME ce qui disparait', () => {
    const res = withoutHiddenValues({ a: 1, b: 2, c: 3 }, new Set(['b', 'c']));
    expect(res.values).toEqual({ a: 1 });
    expect(res.removed.sort()).toEqual(['b', 'c']);
  });

  test('une valeur manquante codifiee est une saisie deliberee : elle se compte', () => {
    const res = withoutHiddenValues({ b: makeMissing('refus') }, new Set(['b']));
    expect(res.removed).toEqual(['b']);
  });

  test('une cle vide ne se compte pas : il n\'y a rien a annoncer', () => {
    const res = withoutHiddenValues({ b: '', c: [] }, new Set(['b', 'c']));
    expect(res.values).toEqual({});
    expect(res.removed).toEqual([]);
  });
});
