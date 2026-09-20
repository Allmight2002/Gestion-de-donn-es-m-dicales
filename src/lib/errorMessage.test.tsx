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
});
