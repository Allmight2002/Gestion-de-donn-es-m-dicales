import { describe, expect, test } from 'vitest';
import { errorMessage } from './errorMessage';

describe('errorMessage', () => {
  // Le delai serveur depasse arrivait tel quel a l'ecran pendant un deplacement de variable
  // ou de section : un texte interne PostgreSQL, en anglais, qui ne dit pas quoi faire.
  test('un delai serveur depasse devient un message actionnable', () => {
    const postgrest = {
      code: '57014',
      message: 'canceling statement due to statement timeout',
      details: null,
      hint: null,
    };
    const rendu = errorMessage(postgrest, 'Erreur');
    expect(rendu).not.toMatch(/canceling statement/i);
    expect(rendu).toMatch(/Rechargez la page/);
  });

  test('le motif fonctionnel renvoye par le serveur reste affiche', () => {
    expect(errorMessage({ message: 'Liste de reordonnancement invalide' }, 'Erreur'))
      .toBe('Liste de reordonnancement invalide');
  });

  test('sans message exploitable, le repli est utilise', () => {
    expect(errorMessage({}, 'Erreur')).toBe('Erreur');
  });

  // Un fichier exporte refuse a l'import ne disait pas quoi corriger.
  test('un refus d\'import dit quoi corriger dans le fichier', () => {
    const refus = (detail: object) => errorMessage(
      { code: 'P0001', message: 'TEMPLATE_IMPORT_INVALID', details: JSON.stringify({ code: 'TEMPLATE_IMPORT_INVALID', ...detail }) },
      'Erreur');
    expect(refus({ reason: 'section_key_invalid', key: 'Mecanisme-lesionnel', position: 4 }))
      .toMatch(/code de bloc « Mecanisme-lesionnel » \(n° 4\) n'est pas accepté.*Rien n'a été créé\.$/);
    expect(refus({ reason: 'too_many', list: 'sections', limit: 500, count: 612 }))
      .toMatch(/612 blocs : le maximum accepté est 500/);
    expect(refus({ reason: 'section_repeat_label_invalid', key: 'suivis', position: 2 }))
      .toMatch(/libellés de saisie du bloc « suivis » sont mal formés/);
    expect(refus({ reason: 'field_section_unknown', key: 'geste', section: 'bloc_x' }))
      .toMatch(/variable « geste » est rangée dans le bloc « bloc_x », absent du fichier/);
    expect(refus({ reason: 'content_incoherent', stage: 'fields' })).toMatch(/étape : variables/);
    expect(refus({})).toMatch(/incomplet ou incohérent.*Rien n'a été créé\.$/);
  });

  test('les gardes d\'un bloc pilote par le diagnostic expliquent la contrainte', () => {
    expect(errorMessage({ code: 'P0001', message: 'DIAGNOSIS_BLOCK_NONCANONICAL' }, 'Erreur'))
      .toMatch(/une seule règle d'affichage/);
    expect(errorMessage({ code: 'P0001', message: 'DIAGNOSIS_BLOCK_EMPTY' }, 'Erreur'))
      .toMatch(/au moins une variable propre.*groupe répétable ne comptent pas/);
  });
});
