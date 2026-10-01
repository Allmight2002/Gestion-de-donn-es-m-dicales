import { describe, expect, test } from 'vitest';
import { messages } from '../i18n/messages.fr';
import type { MessageKey } from '../i18n/messages';
import { repeatableLabels } from './repeatableLabels';

const t = (key: MessageKey) => messages[key];
const base = { label: 'Lésions', sectionKey: 'lesions' };

describe('repeatableLabels', () => {
  test('sans libellé choisi : les libellés génériques, inchangés', () => {
    const labels = repeatableLabels(t, base);
    expect(labels.add).toBe('Ajouter une occurrence');
    expect(labels.rank(2)).toBe('Occurrence 2');
    expect(labels.newTitle).toBe('Nouvelle occurrence de Lésions');
    expect(labels.save).toBe('Enregistrer l’occurrence');
  });

  test('le texte du bouton est repris tel quel ; le nom d’un élément nomme les lignes', () => {
    const labels = repeatableLabels(t, { ...base, addLabel: 'Ajouter une hospitalisation', itemLabel: 'Hospitalisation' });
    expect(labels.add).toBe('Ajouter une hospitalisation');
    expect(labels.rank(3)).toBe('Hospitalisation 3');
    expect(labels.editTitle(3)).toBe('Hospitalisation 3 (Lésions)');
    expect(labels.deleteAction(1)).toBe('Supprimer : Hospitalisation 1 (Lésions)');
    expect(labels.save).toBe('Enregistrer : Hospitalisation');
  });

  test('des libellés faits d’espaces comptent comme absents', () => {
    expect(repeatableLabels(t, { ...base, addLabel: '  ', itemLabel: ' ' }).add).toBe('Ajouter une occurrence');
  });
});
