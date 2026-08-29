// F1 — Proposer un GABARIT a partir d'un fichier existant (Excel/CSV). TOUT medecin a deja son
// tableur ; recreer le dictionnaire a la main est decourageant. On DETECTE les colonnes + on INFERE
// un type par colonne a partir des valeurs, pour transformer « tout retaper » en « verifier une
// proposition ». Logique PURE (aucune I/O) -> testable, rejouable. L'utilisateur ajuste ensuite.
import type { FieldScope, FieldSection, FieldType } from '../data/types';

export interface ProposedField {
  include: boolean;
  fieldKey: string;
  label: string;
  type: FieldType;
  scope: FieldScope;
  section: FieldSection;
  /** Valeurs distinctes proposees pour un champ 'select' (sinon undefined). */
  allowedValues?: string[];
  /** Quelques exemples de valeurs (aide a la relecture). */
  samples: string[];
}

const BOOL_WORDS = new Set(['oui', 'non', 'yes', 'no', 'true', 'false', 'vrai', 'faux']);
const isInt = (s: string) => /^-?\d+$/.test(s);
const isNum = (s: string) => /^-?\d+([.,]\d+)?$/.test(s);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s);

/** Cle technique normalisee (snake_case ASCII) a partir d'un en-tete. */
export function normalizeKey(header: string): string {
  const k = header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return k || 'champ';
}

function inferColumn(values: string[]): { type: FieldType; allowedValues?: string[] } {
  const vals = values.map((v) => v.trim()).filter((v) => v !== '');
  if (vals.length === 0) return { type: 'text' };
  const all = (pred: (s: string) => boolean) => vals.every(pred);

  if (all((s) => BOOL_WORDS.has(s.toLowerCase()))) return { type: 'boolean' };
  if (all(isInt)) return { type: 'integer' };
  if (all(isNum)) return { type: 'number' };
  if (all(isDate)) return { type: 'date' };

  // Peu de valeurs distinctes + repetition + valeurs courtes -> liste a choix.
  const distinct = [...new Set(vals)];
  if (distinct.length >= 2 && distinct.length <= 8 && vals.length >= 2 * distinct.length && distinct.every((v) => v.length <= 40)) {
    return { type: 'select', allowedValues: distinct.sort((a, b) => a.localeCompare(b)) };
  }
  return { type: 'text' };
}

/**
 * Propose une liste de champs a partir des en-tetes + lignes d'un tableur. Chaque colonne devient un
 * champ inclus par defaut, avec un type infere ; l'utilisateur ajuste ensuite (type, portee, etc.).
 */
export function proposeFieldsFromSheet(headers: string[], rows: unknown[][]): ProposedField[] {
  const seen = new Map<string, number>();
  const out: ProposedField[] = [];

  headers.forEach((rawHeader, col) => {
    const label = String(rawHeader ?? '').trim();
    if (label === '') return; // colonne sans en-tete -> ignoree

    let key = normalizeKey(label);
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n > 0) key = `${key}_${n + 1}`; // unicite des cles

    const colValues = rows.map((r) => String(r[col] ?? ''));
    const { type, allowedValues } = inferColumn(colValues);
    const samples = [...new Set(colValues.map((v) => v.trim()).filter((v) => v !== ''))].slice(0, 3);

    out.push({ include: true, fieldKey: key, label, type, scope: 'patient', section: 'clinique', allowedValues, samples });
  });

  return out;
}
