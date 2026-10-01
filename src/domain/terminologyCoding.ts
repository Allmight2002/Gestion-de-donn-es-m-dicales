// Codage terminologique assiste : du resultat serveur aux valeurs stockees.
//
// Regles :
//   * le texte ecrit par le medecin (`raw`) accompagne TOUJOURS l'entree qu'il a produite ;
//   * seules les decisions `automatic` et `suggested` deviennent un code sans action de
//     l'utilisateur ; `suggested` reste marque « a confirmer » ;
//   * plusieurs correspondances plausibles ne sont JAMAIS tranchees ici : l'entree reste non
//     codee et les propositions sont offertes au choix ;
//   * aucune correspondance fiable : le texte est conserve, non code, et reste enregistrable.
import type { CodedConcept, CodedDiagnosis, TerminologyCodingResult } from '../data/terminology';
import {
  isTerminologyValue,
  isUnmatchedTerminology,
  type TerminologyCoding,
  type TerminologyCodingMethod,
  type TerminologyFieldEntry,
  type TerminologyValue,
  type UnmatchedTerminologyValue,
} from '../data/types';

/** Bornes du serveur (`terminology_entry_problem`). */
export const MAX_RAW_LENGTH = 500;
const MAX_NORMALIZED_LENGTH = 300;

/** Propositions a soumettre au choix, rattachees a l'entree non codee qu'elles concernent. */
export interface CodingChoice {
  raw: string;
  normalized: string;
  options: CodedConcept[];
}

const clip = (text: string, max: number) => text.trim().slice(0, max);

/** Texte libre conserve sans code, en attendant (ou a defaut) d'un codage. */
export function unmatchedEntry(
  raw: string,
  method: TerminologyCodingMethod = 'lexical',
  extra: Partial<TerminologyCoding> = {},
): UnmatchedTerminologyValue {
  return { raw: clip(raw, MAX_RAW_LENGTH), coding: { ...extra, method, status: 'unmatched' } };
}

/** Entree provisoire posee au depart du champ : reconnaissable pour etre remplacee ensuite. */
export function isProvisionalEntry(v: unknown, raw: string): boolean {
  return isUnmatchedTerminology(v) && v.raw === clip(raw, MAX_RAW_LENGTH)
    && v.coding.method === 'lexical' && v.coding.normalized === undefined;
}

function baseCoding(result: TerminologyCodingResult, normalized: string): Omit<TerminologyCoding, 'status'> {
  const coding: Omit<TerminologyCoding, 'status'> = { method: result.method, language: result.language || 'fr' };
  const n = clip(normalized, MAX_NORMALIZED_LENGTH);
  if (n) coding.normalized = n;
  if (result.release) coding.release = result.release.slice(0, 64);
  return coding;
}

function codedEntry(
  raw: string,
  concept: CodedConcept,
  coding: Omit<TerminologyCoding, 'status'>,
  status: TerminologyCoding['status'],
): TerminologyValue {
  const full: TerminologyCoding = { ...coding, status, score: concept.score };
  if (concept.uri) full.uri = concept.uri;
  else delete full.uri;
  return { code: concept.code, label: concept.label, raw: clip(raw, MAX_RAW_LENGTH), coding: full };
}

function entryFor(
  raw: string,
  result: TerminologyCodingResult,
  item: CodedDiagnosis,
): { entry: TerminologyFieldEntry; choice: CodingChoice | null } {
  const coding = baseCoding(result, item.normalized);
  if ((item.status === 'automatic' || item.status === 'suggested') && item.best) {
    return { entry: codedEntry(raw, item.best, coding, item.status), choice: null };
  }
  const entry = unmatchedEntry(raw, result.method, { ...coding, score: item.score });
  const options = item.status === 'ambiguous' ? item.alternatives : [];
  return {
    entry,
    choice: options.length ? { raw: entry.raw, normalized: coding.normalized ?? '', options } : null,
  };
}

/**
 * Valeur(s) produites pour un texte. `multiple` : une entree par diagnostic reconnu, sans
 * doublonner un code deja present. Unitaire : un seul diagnostic reconnu se code
 * directement ; plusieurs deviennent des propositions au choix.
 */
export function entriesFromResult(
  raw: string,
  result: TerminologyCodingResult,
  multiple: boolean,
  existingCodes: readonly string[] = [],
): { entries: TerminologyFieldEntry[]; choices: CodingChoice[] } {
  const items = result.items ?? [];
  if (items.length === 0) {
    return { entries: [unmatchedEntry(raw, result.method, baseCoding(result, ''))], choices: [] };
  }
  if (!multiple && items.length > 1) {
    const normalized = items.map((i) => i.normalized).join(' ; ');
    const coding = baseCoding(result, normalized);
    const options = items.flatMap((i) => (i.best ? [i.best] : []))
      .filter((c, index, all) => all.findIndex((x) => x.code === c.code) === index);
    const entry = unmatchedEntry(raw, result.method, coding);
    return {
      entries: [entry],
      choices: options.length ? [{ raw: entry.raw, normalized: coding.normalized ?? '', options }] : [],
    };
  }
  const seen = new Set(existingCodes);
  const entries: TerminologyFieldEntry[] = [];
  const choices: CodingChoice[] = [];
  for (const item of items) {
    const { entry, choice } = entryFor(raw, result, item);
    if (isTerminologyValue(entry)) {
      if (seen.has(entry.code)) continue; // deja present : rien a ajouter
      seen.add(entry.code);
    }
    entries.push(entry);
    if (choice) choices.push(choice);
  }
  return { entries, choices };
}

/**
 * Nouvelle analyse DEMANDEE par le medecin pour une entree restee non codee (par exemple
 * conservee hors connexion, puis rouverte depuis « A faire ») : toute correspondance trouvee,
 * meme claire, devient une PROPOSITION au choix, jamais une valeur. `source` porte la
 * provenance de cette analyse, reprise si le medecin retient une proposition.
 */
export function proposalsFromResult(
  entry: UnmatchedTerminologyValue,
  result: TerminologyCodingResult,
): { source: UnmatchedTerminologyValue; options: CodedConcept[] } {
  const items = result.items ?? [];
  const options = items
    .flatMap((i) => [...(i.best ? [i.best] : []), ...(i.alternatives ?? [])])
    .filter((c, index, all) => all.findIndex((x) => x.code === c.code) === index);
  const normalized = items.map((i) => i.normalized).filter(Boolean).join(' ; ');
  return { source: unmatchedEntry(entry.raw, result.method, baseCoding(result, normalized)), options };
}

/** Cle d'une entree non codee, pour retrouver ses propositions. */
export const choiceKey = (raw: string, normalized: string | undefined) => `${raw}\u0000${normalized ?? ''}`;

/** L'utilisateur valide une proposition `suggested`. */
export function confirmEntry(entry: TerminologyValue): TerminologyValue {
  return entry.coding ? { ...entry, coding: { ...entry.coding, status: 'confirmed' } } : entry;
}

/**
 * Concept retenu pour une entree issue du codage assiste : `confirmed` quand il fait partie
 * des propositions, `manually_modified` quand l'utilisateur l'a cherche lui-meme. Le texte
 * d'origine est conserve dans les deux cas.
 */
export function resolveEntry(
  from: TerminologyFieldEntry,
  concept: { code: string; label: string; uri?: string | null; score?: number },
  status: 'confirmed' | 'manually_modified',
): TerminologyValue {
  const raw = isTerminologyValue(from) ? from.raw : from.raw;
  if (!raw || !from.coding) return { code: concept.code, label: concept.label };
  const coding: TerminologyCoding = { ...from.coding, status };
  delete coding.uri;
  delete coding.score;
  if (concept.uri) coding.uri = concept.uri;
  if (status === 'confirmed' && typeof concept.score === 'number') coding.score = concept.score;
  return { code: concept.code, label: concept.label, raw, coding };
}
