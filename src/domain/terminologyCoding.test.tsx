// Codage assiste : le resultat serveur devient des valeurs stockees, sans jamais perdre le
// texte ecrit ni trancher a la place du medecin. Diagnostics et codes fictifs.
import { describe, expect, test } from 'vitest';
import type { CodedDiagnosis, TerminologyCodingResult } from '../data/terminology';
import { isTerminologyEntry, isUnmatchedTerminology } from '../data/types';
import { confirmEntry, entriesFromResult, isProvisionalEntry, resolveEntry, unmatchedEntry } from './terminologyCoding';

const HSD = { code: 'FIC.02', label: 'Hémorragie sousdurale non traumatique', uri: null, score: 1 };
const HIC = { code: 'FIC.00', label: 'Hémorragie intracérébrale', uri: 'https://id.example.test/fic/00', score: 0.8 };

const item = (over: Partial<CodedDiagnosis>): CodedDiagnosis => ({
  normalized: 'Hématome sous-dural chronique spontané droit',
  status: 'automatic',
  score: 1,
  best: HSD,
  alternatives: [],
  ...over,
});
const result = (items: CodedDiagnosis[]): TerminologyCodingResult => ({
  method: 'ai_assisted',
  release: '2026-01',
  language: 'fr',
  items,
});
const RAW = 'HSD chronique spontané droit';

describe('codage assiste — valeurs produites', () => {
  test('correspondance claire : code, libelle, texte d origine et provenance', () => {
    const { entries, choices } = entriesFromResult(RAW, result([item({})]), false);
    expect(entries).toEqual([{
      code: 'FIC.02',
      label: HSD.label,
      raw: RAW,
      coding: {
        method: 'ai_assisted',
        status: 'automatic',
        normalized: 'Hématome sous-dural chronique spontané droit',
        release: '2026-01',
        language: 'fr',
        score: 1,
      },
    }]);
    expect(choices).toEqual([]);
  });

  test('ambiguite : aucun code impose, les propositions sont offertes', () => {
    const { entries, choices } = entriesFromResult(
      'Hémorragie intracrânienne spontanée',
      result([item({ status: 'ambiguous', score: 0.8, alternatives: [HIC, HSD] })]),
      false,
    );
    expect(isUnmatchedTerminology(entries[0])).toBe(true);
    expect(choices[0].options.map((c) => c.code)).toEqual(['FIC.00', 'FIC.02']);
  });

  test('aucune correspondance : le texte reste enregistrable, sans code', () => {
    const { entries } = entriesFromResult('Syndrome fictif', result([item({ status: 'unmatched', best: null, score: 0.2 })]), true);
    expect(entries).toHaveLength(1);
    expect(isTerminologyEntry(entries[0])).toBe(true);
    expect(entries[0]).not.toHaveProperty('code');
    expect((entries[0] as { raw: string }).raw).toBe('Syndrome fictif');
  });

  test('plusieurs diagnostics : une entree chacun en liste, sans doublonner un code present', () => {
    const { entries } = entriesFromResult(
      'TCE grave avec HSD aigu droit et contusion frontale gauche',
      result([item({}), item({ best: HIC, normalized: 'Contusion frontale gauche' })]),
      true,
      ['FIC.02'],
    );
    expect(entries.map((e) => ('code' in e ? e.code : null))).toEqual(['FIC.00']);
  });

  test('plusieurs diagnostics dans un champ unitaire : proposes au choix', () => {
    const { entries, choices } = entriesFromResult(RAW, result([item({}), item({ best: HIC })]), false);
    expect(isUnmatchedTerminology(entries[0])).toBe(true);
    expect(choices[0].options.map((c) => c.code)).toEqual(['FIC.02', 'FIC.00']);
  });

  test('proposition a confirmer : les autres correspondances restent offertes au choix', () => {
    const { entries, choices } = entriesFromResult(
      RAW,
      result([item({ status: 'suggested', score: 0.75, alternatives: [HSD, HIC] })]),
      true,
    );
    expect(entries[0]).toMatchObject({ code: 'FIC.02', coding: { status: 'suggested' } });
    // Le code propose n'est pas repete parmi les autres.
    expect(choices).toEqual([{ raw: RAW, normalized: 'Hématome sous-dural chronique spontané droit', options: [HIC] }]);
    // Un code pose automatiquement n'en porte pas.
    expect(entriesFromResult(RAW, result([item({ alternatives: [HIC] })]), true).choices).toEqual([]);
  });

  test('champ unitaire a plusieurs diagnostics : meilleurs codes puis autres correspondances', () => {
    const { choices } = entriesFromResult(
      RAW,
      result([item({ status: 'suggested', alternatives: [HIC] }), item({ best: HIC })]),
      false,
    );
    expect(choices[0].options.map((c) => c.code)).toEqual(['FIC.02', 'FIC.00']);
  });

  test('confirmation, choix parmi les propositions et correction manuelle', () => {
    const [suggested] = entriesFromResult(RAW, result([item({ status: 'suggested', score: 0.75 })]), false).entries;
    expect(confirmEntry(suggested as never).coding?.status).toBe('confirmed');

    const picked = resolveEntry(unmatchedEntry(RAW, 'ai_assisted'), HIC, 'confirmed');
    expect(picked).toMatchObject({ code: 'FIC.00', raw: RAW, coding: { status: 'confirmed', uri: HIC.uri } });

    const manual = resolveEntry(picked, { code: 'FIC.02', label: HSD.label }, 'manually_modified');
    expect(manual.raw).toBe(RAW);
    expect(manual.coding).not.toHaveProperty('uri');
    expect(manual.coding?.status).toBe('manually_modified');

    // Un choix direct dans la recherche reste le couple historique, sans provenance.
    expect(resolveEntry({ code: 'X', label: 'Y' }, HIC, 'manually_modified')).toEqual({ code: 'FIC.00', label: HIC.label });
  });

  test('l entree provisoire se reconnait pour etre remplacee, pas une entree codee', () => {
    expect(isProvisionalEntry(unmatchedEntry(RAW), RAW)).toBe(true);
    expect(isProvisionalEntry(unmatchedEntry(RAW, 'ai_assisted', { normalized: 'x' }), RAW)).toBe(false);
  });
});
