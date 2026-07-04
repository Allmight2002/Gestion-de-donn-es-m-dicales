// F1 : la detection de variables depuis un tableur infere les bons types et normalise les cles.
import { describe, expect, test } from 'vitest';
import { proposeFieldsFromSheet, normalizeKey } from './templateFromSheet';

describe('proposeFieldsFromSheet (F1)', () => {
  test('infere les types + normalise/rend uniques les cles + ignore les colonnes sans en-tete', () => {
    const headers = ['Age', 'Sexe', 'Date de naissance', 'Poids (kg)', 'Commentaire', '', 'Age'];
    const rows = [
      [42, 'M', '1980-01-01', '72.5', 'RAS aujourd hui', '', 10],
      [55, 'F', '1968-05-10', '80', 'a revoir un texte libre assez long', '', 20],
      [30, 'M', '1990-12-31', '65.2', 'note du jour', '', 30],
      [31, 'F', '1991-11-30', '66.0', 'encore autre chose', '', 40],
    ];
    const p = proposeFieldsFromSheet(headers, rows);
    const by = (k: string) => p.find((f) => f.fieldKey === k);

    expect(p).toHaveLength(6); // la colonne sans en-tete est ignoree
    expect(by('age')?.type).toBe('integer');
    expect(by('sexe')?.type).toBe('select');
    expect(by('sexe')?.allowedValues).toEqual(['F', 'M']); // distinctes, triees
    expect(by('date_de_naissance')?.type).toBe('date');
    expect(by('poids_kg')?.type).toBe('number');
    expect(by('commentaire')?.type).toBe('text');
    // Cle en double -> suffixe d'unicite.
    expect(by('age_2')?.type).toBe('integer');
    // Tout est inclus par defaut, portee patient par defaut.
    expect(p.every((f) => f.include && f.scope === 'patient')).toBe(true);
  });

  test('booleen detecte sur oui/non ; normalizeKey enleve accents/ponctuation', () => {
    const p = proposeFieldsFromSheet(['Fumeur ?'], [['oui'], ['non'], ['oui']]);
    expect(p[0].fieldKey).toBe('fumeur');
    expect(p[0].type).toBe('boolean');
    expect(normalizeKey('Créatinine (µmol/L)')).toBe('creatinine_mol_l');
  });
});
