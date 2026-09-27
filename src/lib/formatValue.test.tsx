// Audit UI mobile, lot 0 — valeurs lisibles a l'affichage, sans jamais alterer ni perdre la valeur.
import { afterEach, describe, expect, test } from 'vitest';
import { formatCalculatedNumber, formatStoredDate, formatStoredDateTime } from './formatValue';
import { displayFieldValue } from '../data/types';

const originalTz = process.env.TZ;
afterEach(() => { process.env.TZ = originalTz; });

// Espaces fines insecables du francais normalisees pour comparer les nombres groupes.
const plain = (text: string) => text.replace(/[\u202F\u00A0]/g, ' ');

describe('formatStoredDate', () => {
  test('rend une date saisie au format court de la langue', () => {
    expect(formatStoredDate('2026-02-18', 'fr')).toBe('18/02/2026');
    expect(formatStoredDate('2026-02-18', 'en')).toBe('18/02/2026');
  });

  test('lit la date comme date civile : aucun decalage de jour a l ouest de Greenwich', () => {
    process.env.TZ = 'America/New_York';
    // Le piege evite : lue en UTC, la meme chaine tombe la veille dans ce fuseau.
    expect(new Date('2026-02-18').getDate()).toBe(17);
    expect(formatStoredDate('2026-02-18', 'fr')).toBe('18/02/2026');
  });

  test('une valeur hors forme ou impossible est rendue telle quelle', () => {
    expect(formatStoredDate('2026-13-45', 'fr')).toBe('2026-13-45');
    expect(formatStoredDate('hier', 'fr')).toBe('hier');
  });
});

describe('formatStoredDateTime', () => {
  test('rend une date-heure saisie avec l heure saisie', () => {
    expect(formatStoredDateTime('2026-08-21T14:00', 'fr')).toBe('21/08/2026 14:00');
    expect(formatStoredDateTime('2026-08-21T20:52:00', 'fr')).toBe('21/08/2026 20:52');
  });

  test('une valeur portant un fuseau reste brute plutot que d etre convertie', () => {
    expect(formatStoredDateTime('2026-08-21T14:00:00Z', 'fr')).toBe('2026-08-21T14:00:00Z');
    expect(formatStoredDateTime('2026-08-21T14:00+01:00', 'fr')).toBe('2026-08-21T14:00+01:00');
  });
});

describe('formatCalculatedNumber', () => {
  test('arrondit a deux decimales avec le separateur de la langue', () => {
    expect(formatCalculatedNumber(0.286111, 'fr')).toBe('0,29');
    expect(formatCalculatedNumber(0.286111, 'en')).toBe('0.29');
    expect(formatCalculatedNumber(23.456, 'fr')).toBe('23,46');
    expect(formatCalculatedNumber(14, 'fr')).toBe('14');
    expect(plain(formatCalculatedNumber(1234.5678, 'fr'))).toBe('1 234,57');
  });

  test('une petite valeur garde deux chiffres significatifs au lieu de devenir 0', () => {
    expect(formatCalculatedNumber(0.0034, 'fr')).toBe('0,0034');
    expect(formatCalculatedNumber(0, 'fr')).toBe('0');
  });
});

describe('displayFieldValue', () => {
  const date = { type: 'date' };
  const datetime = { type: 'datetime' };

  test('avec la langue, formate dates et dates-heures ; sans langue, garde le rendu historique', () => {
    expect(displayFieldValue('2026-02-18', '—', date, 'fr')).toBe('18/02/2026');
    expect(displayFieldValue('2026-08-21T14:00', '—', datetime, 'fr')).toBe('21/08/2026 14:00');
    expect(displayFieldValue('2026-08-21T14:00', '—', datetime)).toBe('2026-08-21T14:00');
  });

  test('ne formate ni un texte ni une valeur vide', () => {
    expect(displayFieldValue('2026-02-18', '—', { type: 'text' }, 'fr')).toBe('2026-02-18');
    expect(displayFieldValue('', '—', date, 'fr')).toBe('—');
  });
});
