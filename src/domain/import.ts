// Logique PURE d'importation (testable en node) : correspondance colonnes -> cibles, et
// construction des lignes structurees envoyees a la RPC import_records. Les colonnes sont
// identifiees par leur INDEX (pas par le libelle d'en-tete) : un en-tete vide ou DUPLIQUE
// ne provoque donc ni decalage ni collision (audit §6.6). Le decoupage identite / analytique
// est decide ICI (cote client) ; la base le RE-VALIDE et l'ECRIT.
import type { TemplateField } from '../data/types';

export type ImportTarget =
  | 'ignore'
  | 'patient_code'
  | 'encounter_type'
  | 'encounter_date'
  | 'identity.full_name'
  | 'identity.date_of_birth'
  | `patient:${string}`
  | `encounter:${string}`;

/** index de colonne -> cible. */
export type ColumnMapping = Record<number, ImportTarget>;

export interface ImportRow {
  patient_code: string | null;
  source_row_number?: number;
  normalized_row_hash?: string;
  identity: { full_name?: string; date_of_birth?: string } | null;
  patient_data: Record<string, unknown>;
  encounter: { encounter_type: string; encounter_date: string; data: Record<string, unknown> } | null;
}

export interface ImportReport {
  dry_run: boolean;
  status: string;
  conflict?: string;
  patients_new: number;
  patients_updated: number;
  encounters: number;
  error_count: number;
  /** §7.8 : lignes IGNOREES car deja importees avec succes par un lot anterieur (idempotence). */
  already_imported?: number;
  /** Resultat de la requete courante pour un import par lots reprenable. */
  newly_imported?: number;
  already_processed?: number;
  rejected?: number;
  /** Compteurs autoritatifs du lot, relus depuis le serveur. */
  server_row_count?: number;
  server_error_count?: number;
  errors: { row: number; patient_code: string; message: string }[];
}

export interface InFileEncounterDuplicate {
  row: number;
  firstRow: number;
  patientCode: string;
  encounterDate: string;
  encounterType: string;
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const META_ALIASES: Record<string, ImportTarget> = {
  patientcode: 'patient_code', codepatient: 'patient_code', code: 'patient_code', patientid: 'patient_code', id: 'patient_code',
  encountertype: 'encounter_type', typerencontre: 'encounter_type', typederencontre: 'encounter_type', type: 'encounter_type',
  encounterdate: 'encounter_date', daterencontre: 'encounter_date', date: 'encounter_date', dateconsultation: 'encounter_date',
  fullname: 'identity.full_name', nom: 'identity.full_name', nomcomplet: 'identity.full_name', name: 'identity.full_name',
  dateofbirth: 'identity.date_of_birth', datedenaissance: 'identity.date_of_birth', naissance: 'identity.date_of_birth', dob: 'identity.date_of_birth',
};

function stableHash(value: unknown): string {
  const input = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Detecte les rencontres strictement dupliquees sur l'ensemble du fichier.
 * Le serveur applique la meme identite fonctionnelle (patient, date, type et
 * donnees), mais son etat `seen` est local a chaque appel dry-run. Ce controle
 * global rend donc honnete l'apercu lorsque le fichier est decoupe en chunks.
 */
export function findInFileEncounterDuplicates(rows: ImportRow[]): InFileEncounterDuplicate[] {
  const seen = new Map<string, number>();
  const duplicates: InFileEncounterDuplicate[] = [];
  rows.forEach((row, index) => {
    if (!row.encounter || !row.patient_code) return;
    const sourceRow = row.source_row_number ?? index + 1;
    const key = canonicalJson([
      row.patient_code.trim(),
      row.encounter.encounter_date,
      row.encounter.encounter_type,
      row.encounter.data ?? {},
    ]);
    const firstRow = seen.get(key);
    if (firstRow === undefined) {
      seen.set(key, sourceRow);
      return;
    }
    duplicates.push({
      row: sourceRow,
      firstRow,
      patientCode: row.patient_code.trim(),
      encounterDate: row.encounter.encounter_date,
      encounterType: row.encounter.encounter_type,
    });
  });
  return duplicates;
}

// L24 : l'import ne resout AUCUN champ `terminology`, meme a valeur UNIQUE — il transmettrait la
// cellule telle quelle la ou le serveur attend un couple {code, libelle}. Manque ANTERIEUR aux
// variables multivaluees, que L21 rend seulement visible. La cible est donc refusee AU MAPPAGE,
// ce qui nomme le manque a l'utilisateur au lieu de le lui faire decouvrir en fin d'import sous
// la forme d'un echec serveur opaque (spec-variables-multivaluees.md §9).
const isTerminology = (field: TemplateField) => field.type === 'terminology';

// L35 : meme refus, autre motif. Une variable CALCULEE n'a pas de valeur a soi : elle est
// recalculee a l'affichage et a l'export a partir de ses operandes. Une colonne importee vers
// elle serait ignoree en silence -- ou pire, contredirait le calcul affiche a cote. La cible
// est donc refusee AU MAPPAGE, et l'ecran dit pourquoi.
const isCalculated = (field: TemplateField) => Boolean(field.formula && field.formula.trim());

/** Colonne visant une variable de terminologie : cible refusee, colonne laissee « ignoree ». */
export interface TerminologyColumn {
  index: number;
  header: string;
  fieldLabel: string;
}

/** Colonne visant une variable CALCULEE (L35) : meme forme, motif distinct. */
export type CalculatedColumn = TerminologyColumn;

type ColumnMatch =
  | { kind: 'target'; target: ImportTarget }
  | { kind: 'terminology'; field: TemplateField }
  | { kind: 'calculated'; field: TemplateField }
  | { kind: 'none' };

/** Cible refusee au mappage, avec son motif — ou `null` si la variable est importable. */
function refusalFor(field: TemplateField): ColumnMatch | null {
  if (isTerminology(field)) return { kind: 'terminology', field };
  if (isCalculated(field)) return { kind: 'calculated', field };
  return null;
}

/** Resolution d'un en-tete : meta connue, puis champ patient, puis champ rencontre. */
function matchColumn(header: string, patient: TemplateField[], encounter: TemplateField[]): ColumnMatch {
  const n = norm(header ?? '');
  if (!n) return { kind: 'none' };
  const meta = META_ALIASES[n];
  if (meta) return { kind: 'target', target: meta };
  const byName = (f: TemplateField) => norm(f.label) === n || norm(f.fieldKey) === n;
  const pf = patient.find(byName);
  if (pf) return refusalFor(pf) ?? { kind: 'target', target: `patient:${pf.fieldKey}` };
  const ef = encounter.find(byName);
  if (ef) return refusalFor(ef) ?? { kind: 'target', target: `encounter:${ef.fieldKey}` };
  return { kind: 'none' };
}

/** Pre-remplit la correspondance (par INDEX) : meta connue, puis champ de gabarit par libelle/cle. */
export function autoMapColumns(headers: string[], fields: TemplateField[]): ColumnMapping {
  const patient = fields.filter((f) => f.scope === 'patient');
  const encounter = fields.filter((f) => f.scope === 'encounter');
  const map: ColumnMapping = {};
  headers.forEach((h, i) => {
    const match = matchColumn(h, patient, encounter);
    // Une colonne reconnue comme terminologie reste IGNOREE : la proposer promettrait un import
    // que ni le client ni le serveur ne savent faire.
    map[i] = match.kind === 'target' ? match.target : 'ignore';
  });
  return map;
}

/**
 * Colonnes dont l'en-tete designe une variable de terminologie : exactement celles
 * qu'`autoMapColumns` aurait mappees sans ce refus. L'ecran les cite pour que l'utilisateur
 * sache POURQUOI sa colonne « Diagnostic » n'est pas arrivee.
 */
export function findTerminologyColumns(headers: string[], fields: TemplateField[]): TerminologyColumn[] {
  return findRefusedColumns(headers, fields, 'terminology');
}

/**
 * Colonnes dont l'en-tete designe une variable CALCULEE (L35). Meme role que ci-dessus :
 * l'ecran les cite pour que l'utilisateur sache pourquoi sa colonne « durée de séjour » n'est
 * pas arrivee -- au lieu de la croire importee puis de trouver autre chose a l'export.
 */
export function findCalculatedColumns(headers: string[], fields: TemplateField[]): CalculatedColumn[] {
  return findRefusedColumns(headers, fields, 'calculated');
}

function findRefusedColumns(
  headers: string[],
  fields: TemplateField[],
  kind: 'terminology' | 'calculated',
): TerminologyColumn[] {
  const patient = fields.filter((f) => f.scope === 'patient');
  const encounter = fields.filter((f) => f.scope === 'encounter');
  const found: TerminologyColumn[] = [];
  headers.forEach((h, i) => {
    const match = matchColumn(h, patient, encounter);
    if (match.kind === kind) {
      found.push({ index: i, header: h ?? '', fieldLabel: (match as { field: TemplateField }).field.label });
    }
  });
  return found;
}

/** Champ de gabarit vise par une cible, si elle en designe un. */
function fieldForTarget(target: ImportTarget, fields: TemplateField[]): TemplateField | undefined {
  for (const scope of ['patient', 'encounter'] as const) {
    const prefix = `${scope}:`;
    if (!target.startsWith(prefix)) continue;
    const key = target.slice(prefix.length);
    return fields.find((f) => f.scope === scope && f.fieldKey === key);
  }
  return undefined;
}

/** Cible REFUSEE au mappage (L24) : le champ vise est de type `terminology`, multivalue ou non. */
export function terminologyTargetField(target: ImportTarget, fields: TemplateField[]): TemplateField | null {
  const field = fieldForTarget(target, fields);
  return field && isTerminology(field) ? field : null;
}

/** Cible REFUSEE au mappage (L35) : le champ vise est une variable CALCULEE. */
export function calculatedTargetField(target: ImportTarget, fields: TemplateField[]): TemplateField | null {
  const field = fieldForTarget(target, fields);
  return field && isCalculated(field) ? field : null;
}

/** Cibles (hors "ignore") assignees a PLUSIEURS colonnes -> conflit a resoudre avant import. */
export function duplicateTargets(mapping: ColumnMapping): ImportTarget[] {
  const counts = new Map<ImportTarget, number>();
  for (const t of Object.values(mapping)) {
    if (t === 'ignore') continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([t]) => t);
}

/** Construit les lignes structurees a partir des lignes brutes (cellules par INDEX) + mapping. */
export function buildImportRows(rows: unknown[][], mapping: ColumnMapping, fields: TemplateField[] = []): ImportRow[] {
  const entries = Object.entries(mapping).map(([i, t]) => [Number(i), t] as const);
  const fieldByTarget = new Map<string, TemplateField>();
  for (const f of fields) fieldByTarget.set(`${f.scope}:${f.fieldKey}`, f);
  const coerce = (value: unknown, field: TemplateField | undefined): unknown => {
    const s = value == null ? '' : String(value).trim();
    if (s === '') return undefined;
    if (!field) return s;
    if (field.type === 'number' || field.type === 'integer') {
      const n = typeof value === 'number' ? value : Number(s.replace(',', '.'));
      return Number.isFinite(n) ? n : s;
    }
    if (field.type === 'boolean') {
      const v = s.toLowerCase();
      if (['true', 'vrai', 'oui', 'yes', '1'].includes(v)) return true;
      if (['false', 'faux', 'non', 'no', '0'].includes(v)) return false;
      return s;
    }
    if (field.type === 'multiselect') {
      return s.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
    }
    return s;
  };
  return rows.map((cells, rowIndex) => {
    let patient_code: string | null = null;
    const identity: { full_name?: string; date_of_birth?: string } = {};
    const patient_data: Record<string, unknown> = {};
    const encData: Record<string, unknown> = {};
    let encType = '';
    let encDate = '';

    for (const [i, target] of entries) {
      if (target === 'ignore') continue;
      const v = cells[i];
      const s = v == null ? '' : String(v).trim();
      if (s === '') continue;
      if (target === 'patient_code') patient_code = s;
      else if (target === 'encounter_type') encType = s;
      else if (target === 'encounter_date') encDate = s;
      else if (target === 'identity.full_name') identity.full_name = s;
      else if (target === 'identity.date_of_birth') identity.date_of_birth = s;
      else if (target.startsWith('patient:')) {
        const key = target.slice('patient:'.length);
        const value = coerce(v, fieldByTarget.get(`patient:${key}`));
        if (value !== undefined) patient_data[key] = value;
      }
      else if (target.startsWith('encounter:')) {
        const key = target.slice('encounter:'.length);
        const value = coerce(v, fieldByTarget.get(`encounter:${key}`));
        if (value !== undefined) encData[key] = value;
      }
    }

    const hasEnc = encDate !== '' || encType !== '' || Object.keys(encData).length > 0;
    const hasIdentity = !!(identity.full_name || identity.date_of_birth);
    return {
      patient_code,
      source_row_number: rowIndex + 1,
      normalized_row_hash: stableHash(cells.map((v) => (v == null ? '' : String(v).trim()))),
      identity: hasIdentity ? identity : null,
      patient_data,
      encounter: hasEnc ? { encounter_type: encType || 'consultation', encounter_date: encDate, data: encData } : null,
    };
  });
}
