// Valeur PROPOSEE a la saisie (L28).
//
// Une proposition n'est jamais une donnee : elle epargne une frappe a la creation d'une
// fiche, et rien de plus. Elle n'est appliquee QU'A LA CREATION -- jamais a la correction
// d'une fiche existante, jamais a l'import -- et le serveur ne la reecrit jamais : effacee
// par la personne qui saisit, la valeur reste vide.
import type { FieldType, TemplateField } from '../data/types';

/** Date du jour, resolue A LA SAISIE : une date figee dans le gabarit vieillirait. */
export const TODAY_TOKEN = '__today__';
/** Idem pour une date + heure. */
export const NOW_TOKEN = '__now__';

/** Types acceptant une proposition. `multiselect` et `terminology` en sont exclus cote base :
 *  proposer un diagnostic ou un jeu de modalites ne fait pas gagner une frappe, il repond. */
export const DEFAULTABLE_TYPES: FieldType[] = [
  'text', 'number', 'integer', 'date', 'datetime', 'boolean', 'select',
];

export const supportsDefaultValue = (type: FieldType) => DEFAULTABLE_TYPES.includes(type);

const pad = (n: number) => String(n).padStart(2, '0');
// Heure LOCALE, jamais UTC : a Ndjamena, une consultation saisie a 00h30 doit porter la
// date du jour local, pas celle de la veille a Greenwich.
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDateTime = (d: Date) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Mots qui signalent une variable de JUGEMENT clinique : y proposer une reponse ne fait pas
// gagner du temps, elle fabrique de la donnee. Liste volontairement courte et lisible ; elle
// declenche un avertissement, jamais un refus (la decision reste au medecin).
const CLINICAL_JUDGMENT_TERMS = [
  'complication', 'deces', 'mortalite', 'issue', 'evolution', 'guerison',
  'sequelle', 'recidive', 'rechute', 'effet indesirable', 'gravite', 'severite',
  'aggravation', 'amelioration', 'survie', 'statut vital', 'diagnostic', 'symptome',
  'outcome', 'death', 'relapse',
].map(stripAccents);

/** Formes dont une valeur proposee devient, par construction, la reponse rendue. */
const ORIENTING_TYPES: FieldType[] = ['boolean', 'select'];

export type DefaultValueRisk = 'clinical' | 'shape' | null;

/**
 * La proposition de cette variable risque-t-elle d'orienter la reponse ?
 * `clinical` : son intitule designe un jugement clinique. `shape` : oui/non ou liste, ou la
 * valeur proposee EST la reponse tant que personne ne la change.
 */
export function defaultValueRisk(field: { fieldKey: string; label: string; type: FieldType }): DefaultValueRisk {
  const haystack = stripAccents(`${field.label} ${field.fieldKey}`.toLowerCase()).replace(/_/g, ' ');
  if (CLINICAL_JUDGMENT_TERMS.some((term) => haystack.includes(term))) return 'clinical';
  if (ORIENTING_TYPES.includes(field.type)) return 'shape';
  return null;
}

/**
 * Traduit la proposition enregistree dans le gabarit en valeur de formulaire.
 * Renvoie `undefined` quand il n'y a rien a proposer : le champ reste alors absent des
 * valeurs, donc absent de ce qui sera enregistre.
 */
export function resolveDefaultValue(field: TemplateField, now: Date = new Date()): unknown {
  const raw = field.defaultValue?.trim();
  if (!raw || !supportsDefaultValue(field.type)) return undefined;
  switch (field.type) {
    case 'boolean':
      return raw === 'true';
    case 'number':
    case 'integer': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'date':
      return raw === TODAY_TOKEN ? localDate(now) : raw;
    case 'datetime':
      return raw === NOW_TOKEN ? localDateTime(now) : raw;
    default:
      return raw;
  }
}

/**
 * Valeurs initiales d'un formulaire de CREATION, et la liste des cles ainsi preremplies --
 * celles que le formulaire signale comme « proposees » tant que personne n'y a touche.
 */
export function initialValuesFromDefaults(
  fields: TemplateField[],
  now: Date = new Date(),
): { values: Record<string, unknown>; prefilled: Set<string> } {
  const values: Record<string, unknown> = {};
  const prefilled = new Set<string>();
  for (const field of fields) {
    const value = resolveDefaultValue(field, now);
    if (value === undefined) continue;
    values[field.fieldKey] = value;
    prefilled.add(field.fieldKey);
  }
  return { values, prefilled };
}

/**
 * Une proposition EFFACEE ne doit laisser aucune trace : elle n'a jamais ete une valeur.
 * Sans cela, vider un champ prerempli enregistrerait une chaine vide la ou une fiche non
 * preremplie n'aurait tout simplement pas la cle -- deux ecritures differentes pour la meme
 * absence de reponse.
 */
export const isClearedValue = (value: unknown) => value === '' || value === null || value === undefined;

/** Retire une cle de l'ensemble « propose » des qu'on y touche (identite stable sinon). */
export function forgetPrefilled(prefilled: Set<string>, key: string): Set<string> {
  if (!prefilled.has(key)) return prefilled;
  const next = new Set(prefilled);
  next.delete(key);
  return next;
}
