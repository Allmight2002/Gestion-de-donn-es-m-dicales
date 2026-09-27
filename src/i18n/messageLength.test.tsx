// Audit UI mobile, lot 3 (T3-A) : un message affiché en permanence tient en une phrase courte.
// Son explication va dans `<clé>_details`, lue à la demande derrière ⓘ. Le décompte est celui de
// l'audit (mots séparés par des espaces) : il en trouvait 113 de 20 mots ou plus.
import { describe, expect, test } from 'vitest';
import { messages as fr } from './messages.fr';
import { messages as en } from './messages.en';

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const isDetails = (key: string) => key.endsWith('_details');
const over = (catalog: Record<string, string>, keep: (key: string) => boolean, max: number) =>
  Object.entries(catalog)
    .filter(([key, text]) => keep(key) && words(text) >= max)
    .map(([key, text]) => `${key} (${words(text)} mots)`);

describe.each([['fr', fr], ['en', en]] as const)('catalogue %s', (_language, catalog) => {
  test('aucun message affiché en permanence ne fait 20 mots ou plus', () => {
    expect(over(catalog, (key) => !isDetails(key), 20)).toEqual([]);
  });

  test('une explication à la demande reste lisible d’un coup d’œil', () => {
    expect(over(catalog, isDetails, 40)).toEqual([]);
  });
});
