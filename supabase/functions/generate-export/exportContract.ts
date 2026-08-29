// Contrat pur partage entre le navigateur (tests de domaine) et l'Edge Function.
// Les noms de colonnes sont volontairement des identifiants stables, jamais des labels.
export type AggregationRule = 'first' | 'last';

/**
 * Profil d'export (L45). `analysis` : lisible directement pour l'analyse, qui se construit
 * aux lots L46~L49 (code stable en colonne, feuilles `Modalités` puis `Métadonnées`).
 * `complete` : conserve pendant la transition les colonnes techniques de reimportation et
 * de tracabilite. Le generateur garde `complete` en defaut pour ne pas changer les sorties
 * existantes ; c'est le handler qui injecte le profil resolu (analyse par defaut cote appel).
 */
export type ExportProfile = 'analysis' | 'complete';

export interface ExportPatient {
  code: string;
  data: Record<string, unknown>;
  templateVersionId?: string;
}
export interface ExportEncounter {
  id: string;
  patientCode: string;
  encounterDate: string;
  encounterType: string;
  data: Record<string, unknown>;
  templateVersionId?: string;
  ageValue?: unknown;
  ageUnit?: string | null;
}
export interface ExportField {
  fieldKey: string;
  label: string;
  description?: string | null;
  scope: 'patient' | 'encounter';
  /** CODE de la section (L31) : stable, c'est lui qui survit a une correction de libelle. */
  section: string;
  /** Libelle de la section, lisible. Absent = version anterieure au lot, ou section detachee. */
  sectionLabel?: string | null;
  type: string;
  /** Variable multivaluee (L22) : accepte une liste ordonnee de couples terminologiques. */
  isMultiple?: boolean | null;
  unit: string | null;
  /** Miroir des codes d'options (L30) : ce que contient reellement la colonne de donnees. */
  allowedValues: unknown[] | null;
  /** Options de liste (L30) : `{value_key, label, is_active}`. Absent = instantane ancien. */
  allowedOptions?: unknown[] | null;
  /** Raisons de valeur manquante proposees pour CETTE variable (L33). Absent = instantane ancien. */
  missingReasons?: readonly string[] | null;
  /**
   * Variable CALCULEE (L35) : `date_sortie - date_entree`. Rien n'est stocke sous cette cle ;
   * la colonne est recalculee a l'export. Absent/null = variable saisie, comme avant le lot.
   */
  formula?: string | null;
  /** Unite de restitution de la formule, rattachee a chaque version comme la formule elle-meme. */
  formulaUnitByVersion?: Record<string, string | null>;
  /**
   * La formule appartient a la VERSION de gabarit (decision L35-A) : une fiche saisie sous
   * l'ancienne version garde le resultat de l'ancienne formule. `mergeExportFields` unit une
   * colonne a travers ses versions ; cette table dit laquelle s'applique a quelle fiche, au
   * lieu d'appliquer a tout le monde une formule choisie au hasard du tri.
   */
  formulaByVersion?: Record<string, string>;
  templateVersionIds?: string[];
  displayOrder?: number;
}
export interface ExportTable {
  columns: string[];
  rows: Record<string, unknown>[];
}

/**
 * Raisons de valeur manquante, dans l'ordre canonique de la base. Les trois premieres sont
 * HISTORIQUES : ni leur code ni leur sens ne changent, et une fiche deja saisie reste lisible
 * telle quelle. `refus` et `non_documente` sont ajoutees par L33 ; `non_documente` se distingue
 * d'`inconnu`, qui laisse croire que l'information a ete cherchee.
 *
 * Cette liste est la SEULE : `src/domain/validation.ts` l'importe au lieu de la recopier
 * (via `src/domain/export.ts`). Deux listes qui divergeraient produiraient un export
 * incoherent avec la saisie -- une valeur saisissable mais illisible a l'export.
 */
export const MISSING_CODES = ['non_fait', 'inconnu', 'non_applicable', 'refus', 'non_documente'] as const;
export type MissingCode = (typeof MISSING_CODES)[number];
const MISSING_KEY = '__missing__';

function isMissing(value: unknown): value is { __missing__: MissingCode } {
  return typeof value === 'object' && value !== null && MISSING_KEY in value &&
    MISSING_CODES.includes((value as Record<string, unknown>)[MISSING_KEY] as MissingCode);
}

function missingCodeOf(value: unknown): MissingCode | null {
  return isMissing(value) ? value[MISSING_KEY] : null;
}

/** Sans doublon et dans l'ordre canonique de `MISSING_CODES`, comme en base. */
export function sortMissingReasons(reasons: readonly string[]): string[] {
  const present = new Set(reasons);
  return MISSING_CODES.filter((c) => present.has(c));
}

export const FORBIDDEN_EXPORT_KEYS = [
  'full_name',
  'name',
  'patient_name',
  'first_name',
  'last_name',
  'date_of_birth',
  'dob',
  'birth_date',
  'phone',
  'address',
  'contact',
  'email',
];
export function assertNoIdentity(columns: string[]): void {
  const bad = columns.find((c) => FORBIDDEN_EXPORT_KEYS.includes(c.toLowerCase()));
  if (bad) throw new Error(`Colonne identifiante interdite a l'export: ${bad}`);
}

export const columnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `${field.scope}__${field.fieldKey}`;

/**
 * Identifiant analytique d'une variable (L46) : court, ASCII, unique et stable, distinct du
 * libelle humain et des UUID techniques. C'est un REPLI DETERMINISTE sur `scope` + `field_key`
 * (l'identifiant technique stable deja utilise comme cle de colonne) : rien n'est ajoute au
 * gabarit, donc aucune migration, et l'interpretation des anciens gabarits est conservee telle
 * quelle. Un libelle peut changer sans changer l'identifiant.
 */
export const analyticId = (field: Pick<ExportField, 'scope' | 'fieldKey'>): string => columnId(field);

/**
 * Refuse explicitement les collisions d'identifiants analytiques (L46). `mergeExportFields`
 * unifie deja par colonne : au sein du jeu fusionne, deux variables ne partagent jamais le meme
 * identifiant. La garde piege le cas pathologique ou deux cles de champ DIFFERENTES se
 * normalisent vers le meme identifiant lisible (casse d'un renommage, separateurs), ce qui
 * rendrait deux variables indiscernables dans le fichier. Fail-closed : on refuse plutot que
 * de deviner.
 */
export function assertNoAnalyticIdCollisions(fields: readonly ExportField[]): void {
  const seen = new Map<string, string>();
  for (const field of fields) {
    const normalized = field.fieldKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const key = `${field.scope}__${normalized}`;
    const existing = seen.get(key);
    if (existing !== undefined && existing !== field.fieldKey) {
      throw new Error(`Collision d'identifiants analytiques: ${key}`);
    }
    seen.set(key, field.fieldKey);
  }
}

/**
 * Colonne du CODE d'un champ de terminologie. Le libelle part dans la colonne principale
 * pour la lecture, le code dans celle-ci pour l'analyse : c'est lui qui reste stable quand
 * un libelle est corrige, et donc lui qui permet de regrouper sans scinder une maladie.
 */
export const codeColumnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `terminology_code__${columnId(field)}`;

/** Colonne du NOMBRE d'elements d'une variable multivaluee (L22/L36). */
export const nbColumnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `nb__${columnId(field)}`;

/**
 * Colonne du CODE d'une liste controlee (L30) — meme convention que la terminologie, et
 * pour la meme raison : le libelle part dans la colonne principale pour la lecture, le
 * code dans celle-ci pour l'analyse. C'est le code qui reste stable quand un libelle est
 * corrige, donc lui qui permet de regrouper sans scinder une modalite en deux.
 */
export const optionCodeColumnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `option_code__${columnId(field)}`;

const isOptionList = (field: Pick<ExportField, 'type'>) => field.type === 'select' || field.type === 'multiselect';

/** Une liste multivaluee a des indicatrices, meme si `is_multiple` reste reserve a terminology. */
export const isMultivalueField = (field: Pick<ExportField, 'type' | 'isMultiple'>) =>
  field.type === 'multiselect' || (field.type === 'terminology' && Boolean(field.isMultiple));

interface RawOption {
  value_key?: unknown;
  label?: unknown;
  is_active?: unknown;
}

/** Options d'une variable, avec repli sur les seuls codes pour un instantane ancien. */
function optionsOf(field: ExportField): { key: string; label: string; isActive: boolean }[] {
  if (Array.isArray(field.allowedOptions)) {
    return field.allowedOptions.flatMap((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const o = raw as RawOption;
      if (typeof o.value_key !== 'string' || o.value_key === '') return [];
      return [{
        key: o.value_key,
        label: typeof o.label === 'string' && o.label !== '' ? o.label : o.value_key,
        isActive: o.is_active !== false,
      }];
    });
  }
  return (field.allowedValues ?? [])
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .map((v) => ({ key: v, label: v, isActive: true }));
}

/** Libelle d'un code stocke. Un code inconnu est rendu TEL QUEL, jamais efface. */
const labelOfOption = (field: ExportField, stored: unknown): string => {
  if (typeof stored !== 'string') return '';
  return optionsOf(field).find((o) => o.key === stored)?.label ?? stored;
};

/**
 * Les deux cellules d'une liste controlee : le libelle pour la lecture, le code pour
 * l'analyse. Un code de valeur manquante part dans la colonne principale, comme partout
 * ailleurs, et laisse la colonne de code vide.
 */
function optionCells(field: ExportField, v: unknown): { label: string; code: string } {
  const missing = missingCodeOf(v);
  if (missing) return { label: missing, code: '' };
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && MISSING_KEY in v) {
    throw new Error('Code de valeur manquante invalide');
  }
  if (v === null || v === undefined || v === '') return { label: '', code: '' };
  if (Array.isArray(v)) {
    const keys = v.filter((x): x is string => typeof x === 'string');
    return { label: keys.map((k) => labelOfOption(field, k)).join('; '), code: keys.join('; ') };
  }
  if (typeof v !== 'string') return { label: formatValue(v, field.type) as string, code: '' };
  return { label: labelOfOption(field, v), code: v };
}

const isTerminologyValue = (v: unknown): v is { code: string; label: string } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  typeof (v as { code?: unknown }).code === 'string' &&
  typeof (v as { label?: unknown }).label === 'string';

const isTerminologyList = (v: unknown): v is { code: string; label: string }[] =>
  Array.isArray(v) && v.length > 0 && v.every(isTerminologyValue);

export const formatValue = (v: unknown, type?: string): unknown => {
  if (v === null || v === undefined) return '';
  const missingCode = missingCodeOf(v);
  if (missingCode) return missingCode;
  if (typeof v === 'object' && v !== null && MISSING_KEY in v) {
    throw new Error('Code de valeur manquante invalide');
  }
  // Un diagnostic est un couple code + libelle (ou une liste de couples pour L22) :
  // sans ce cas, `String(v)` rendait « [object Object] » dans toute la colonne.
  if (isTerminologyValue(v)) return v.label;
  if (isTerminologyList(v)) return v.map((item) => item.label).join('; ');
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'boolean') return v ? '1' : '0';
  // D14 : conserver les nombres natifs JS pour que SheetJS produise des cellules type=n
  if (typeof v === 'number') return v;
  if ((type === 'integer' || type === 'number') && typeof v === 'string' && v !== '' && NUMERIC_LITERAL.test(v)) {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return String(v);
};

// =============================================================================
// Variables calculees (L35) — la calculatrice, jamais une formule clinique
// =============================================================================
//
// L'utilisateur ecrit lui-meme le calcul dans son gabarit : `date_sortie - date_entree`.
// Le produit ne livre AUCUNE formule toute faite : ni IMC, ni Glasgow, ni clairance. Il
// livre l'operateur, et le refus de ce qui n'a pas de sens.
//
// LE RESULTAT N'EST JAMAIS STOCKE. Il n'entre ni dans `patient.data` ni dans
// `encounter.data`, et aucune RPC ne le calcule. Il est recalcule a l'affichage et a
// l'export, par CE module — le meme fichier que lisent le navigateur (via
// `src/domain/export.ts`) et l'Edge Function de production. Une seule implementation de la
// semantique, donc aucune derive possible entre ce qu'un ecran montre et ce qu'un fichier
// exporte contient ; et le hors-ligne suit sans travail supplementaire.
//
// PL/pgSQL sait qu'une variable est calculee (`formula is not null`) et s'en sert pour
// l'ECARTER de la completude. Il n'evalue jamais la formule. C'est cette distinction qui
// tient tout le lot.

/** Les quatre operations, et rien d'autre : pas de condition, pas d'appel de fonction. */
export const FORMULA_OPERATORS = ['+', '-', '*', '/'] as const;
export type FormulaOperator = (typeof FORMULA_OPERATORS)[number];

/** Unites de restitution d'une soustraction entre deux dates/date-heures. */
export const FORMULA_TIME_UNITS = ['seconds', 'minutes', 'hours', 'days', 'weeks', 'years'] as const;
export type FormulaTimeUnit = (typeof FORMULA_TIME_UNITS)[number];
export const DEFAULT_FORMULA_TIME_UNIT: FormulaTimeUnit = 'days';

const FORMULA_TIME_UNIT_FACTORS: Record<FormulaTimeUnit, number> = {
  seconds: 86_400,
  minutes: 1_440,
  hours: 24,
  days: 1,
  weeks: 1 / 7,
  // Convention explicite : une annee de rendu vaut 365,25 jours.
  years: 1 / 365.25,
};

const INTEGER_FORMULA_TIME_UNITS = new Set<FormulaTimeUnit>(['seconds', 'minutes', 'hours', 'days']);

export const isFormulaTimeUnit = (value: unknown): value is FormulaTimeUnit =>
  typeof value === 'string' && (FORMULA_TIME_UNITS as readonly string[]).includes(value);

/** Les formules historiques sans unite restent des durees en jours. */
export const normalizeFormulaTimeUnit = (value: unknown): FormulaTimeUnit =>
  isFormulaTimeUnit(value) ? value : DEFAULT_FORMULA_TIME_UNIT;

export type FormulaOperand =
  | { kind: 'field'; fieldKey: string }
  | { kind: 'literal'; value: number };

/**
 * UNE seule operation, deux operandes. Pas d'imbrication, donc aucune regle de priorite
 * invisible : `a + b / 2` ne peut pas exister, et personne n'a a deviner ce qu'il vaut.
 */
export interface ParsedFormula {
  left: FormulaOperand;
  operator: FormulaOperator;
  right: FormulaOperand;
}

/** Type de sortie DEDUIT de la formule, jamais choisi par l'utilisateur. */
export type FormulaOutputType = 'number' | 'integer';

/**
 * Types de variables admissibles comme operande. Une date-heure se calcule dans la meme
 * unite que `date - date` (des jours), mais peut produire une fraction : la sortie devient
 * alors `number` au lieu de `integer`.
 */
export const FORMULA_OPERAND_TYPES = ['number', 'integer', 'date', 'datetime'] as const;

/** Nom interne admissible comme operande : c'est lui qui rend la formule relisible. */
const FORMULA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORMULA_NUMBER = /^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/;

export const isFormulaIdentifier = (key: string): boolean => FORMULA_IDENTIFIER.test(key);

/** Ce qu'une variable doit exposer pour qu'on sache la lire — rien de plus. */
export interface FormulaFieldRef {
  fieldKey: string;
  type: string;
  /** Non nulle = variable CALCULEE : jamais un operande (voir `checkFormula`). */
  formula?: string | null;
}

function parseOperand(token: string): FormulaOperand | null {
  if (FORMULA_NUMBER.test(token)) {
    const value = Number(token);
    return Number.isFinite(value) ? { kind: 'literal', value } : null;
  }
  return FORMULA_IDENTIFIER.test(token) ? { kind: 'field', fieldKey: token } : null;
}

/**
 * Lecture STRICTE : trois jetons separes par des espaces. Le constructeur ecrit toujours
 * cette forme ; tout le reste est refuse a l'enregistrement plutot que devine. Une formule
 * qu'on ne sait pas lire ne doit pas produire un resultat approximatif.
 */
export function parseFormula(text: string | null | undefined): ParsedFormula | null {
  if (typeof text !== 'string') return null;
  const tokens = text.trim().split(/\s+/);
  if (tokens.length !== 3) return null;
  const [rawLeft, rawOperator, rawRight] = tokens;
  if (!(FORMULA_OPERATORS as readonly string[]).includes(rawOperator)) return null;
  const left = parseOperand(rawLeft);
  const right = parseOperand(rawRight);
  if (!left || !right) return null;
  return { left, operator: rawOperator as FormulaOperator, right };
}

const operandText = (operand: FormulaOperand): string =>
  operand.kind === 'field' ? operand.fieldKey : String(operand.value);

/** Forme canonique stockee en base : un espace de chaque cote de l'operateur. */
export const formatFormula = (parsed: ParsedFormula): string =>
  `${operandText(parsed.left)} ${parsed.operator} ${operandText(parsed.right)}`;

/**
 * Motifs de refus. Ce sont des CODES : l'interface les traduit, la base rend ses propres
 * messages. Deux libelles a tenir, une seule regle.
 */
export type FormulaProblem =
  | 'syntax'
  | 'self_reference'
  | 'unknown_operand'
  | 'calculated_operand'
  | 'operand_type'
  | 'operator_type'
  | 'constant_only';

export interface FormulaCheck {
  ok: boolean;
  problem?: FormulaProblem;
  /** Nom interne de la variable en cause, quand le refus en designe une. */
  detail?: string;
  parsed?: ParsedFormula;
  outputType?: FormulaOutputType;
}

const isTemporalRef = (ref: FormulaFieldRef) => ref.type === 'date' || ref.type === 'datetime';

/**
 * Valide une formule AU MOMENT OU LA VARIABLE EST ENREGISTREE : operandes existants, non
 * calcules, de types compatibles. Une formule invalide est refusee la, pas decouverte a la
 * saisie sous la forme d'un resultat vide que personne ne sait expliquer.
 *
 * `peers` ne contient que les variables de la MEME portee : une variable de rencontre ne
 * lit pas une donnee permanente, faute de quoi le formulaire devrait charger un second bloc
 * de donnees pour afficher un resultat.
 */
export function checkFormula(
  text: string | null | undefined,
  selfFieldKey: string,
  peers: readonly FormulaFieldRef[],
  resultUnit?: string | null,
): FormulaCheck {
  const parsed = parseFormula(text);
  if (!parsed) return { ok: false, problem: 'syntax' };

  const refs: (FormulaFieldRef | null)[] = [];
  for (const operand of [parsed.left, parsed.right]) {
    if (operand.kind === 'literal') {
      refs.push(null);
      continue;
    }
    if (operand.fieldKey === selfFieldKey) {
      return { ok: false, problem: 'self_reference', detail: operand.fieldKey };
    }
    const ref = peers.find((p) => p.fieldKey === operand.fieldKey);
    if (!ref) return { ok: false, problem: 'unknown_operand', detail: operand.fieldKey };
    // Une variable calculee ne peut pas en referencer une autre. Cette interdiction
    // SUPPRIME la detection de cycles au lieu de la coder : il n'y a jamais de chaine.
    if (ref.formula) return { ok: false, problem: 'calculated_operand', detail: operand.fieldKey };
    if (!(FORMULA_OPERAND_TYPES as readonly string[]).includes(ref.type)) {
      return { ok: false, problem: 'operand_type', detail: operand.fieldKey };
    }
    refs.push(ref);
  }

  // Deux constantes ne font pas une variable : `2 + 3` vaut 5 pour tout le monde et
  // n'appartient pas au dossier.
  if (refs.every((r) => r === null)) return { ok: false, problem: 'constant_only' };

  const temporals = refs.filter((r): r is FormulaFieldRef => r !== null && isTemporalRef(r));
  if (temporals.length === 2) {
    // La SEULE operation admise entre deux dates/date-heures est la soustraction. Une paire
    // de dates reste entiere ; la presence d'une date-heure autorise une fraction de jour.
    if (parsed.operator !== '-') return { ok: false, problem: 'operator_type' };
    return {
      ok: true,
      parsed,
      outputType: temporals.every((ref) => ref.type === 'date') &&
          INTEGER_FORMULA_TIME_UNITS.has(normalizeFormulaTimeUnit(resultUnit))
        ? 'integer'
        : 'number',
    };
  }
  // Une date/date-heure melangee a un nombre n'a pas de sens ici : « date + 3 » demanderait
  // de decider si 3 est un jour, un mois ou une heure. On refuse plutot que de choisir.
  if (temporals.length === 1) return { ok: false, problem: 'operator_type' };
  return { ok: true, parsed, outputType: 'number' };
}

/** Index des operandes, construit UNE fois par export plutot qu'a chaque ligne. */
export const formulaFieldIndex = (
  fields: readonly FormulaFieldRef[],
): Map<string, FormulaFieldRef> => new Map(fields.map((f) => [f.fieldKey, f]));

const MS_PER_DAY = 86_400_000;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:(Z)|([+-])(\d{2}):(\d{2}))?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDateParts(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function utcMilliseconds(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number | null {
  if (
    !validDateParts(year, month, day) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59
  ) {
    return null;
  }
  // `Date.UTC(0..99, ...)` remplace ces annees par 1900..1999. Les setters UTC gardent
  // donc ici la meme annee que la valeur entree, y compris pour les dates anciennes.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day &&
      date.getUTCHours() === hour &&
      date.getUTCMinutes() === minute &&
      date.getUTCSeconds() === second
    ? date.getTime()
    : null;
}

/** Date stockee -> jours depuis l'epoque. Une date invalide vaut ABSENTE, jamais zero. */
function dateToDays(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = DATE_PREFIX.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = utcMilliseconds(year, month, day);
  return ms === null ? null : ms / MS_PER_DAY;
}

/** Date-heure stockee -> jours depuis l'epoque, avec une fraction si necessaire. */
function datetimeToDays(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = DATETIME_RE.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (match[8] !== undefined) {
    const offsetHour = Number(match[9]);
    const offsetMinute = Number(match[10]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
  }
  const wallMs = utcMilliseconds(year, month, day, hour, minute, second);
  if (wallMs === null) return null;
  const offsetMinutes = match[7] === 'Z'
    ? 0
    : match[8]
    ? (match[8] === '+' ? 1 : -1) * (Number(match[9]) * 60 + Number(match[10]))
    : 0;
  return (wallMs - offsetMinutes * 60_000) / MS_PER_DAY;
}

// L48 : dates et date-heures natives dans le classeur.
//
// Convention FIXEE pour les datetime : les valeurs stockees sont ISO ; elles sont rendues dans le
// classeur en heure UTC (fraction de jour = heure/minute/seconde UTC de l'instant), secondes
// comprises, ce qui est reproductible quel que soit le fuseau du lecteur. Le CSV, lui, conserve
// la representation ISO telle quelle. Dans les deux formats, une date/datetime invalide reste
// lisible et n'est JAMAIS masquee par un zero.
/** Jours entre 1970-01-01 et l'origine d'Excel (systeme 1900). */
export const EXCEL_EPOCH_OFFSET_DAYS = 25_569;

/** Date ISO wall-clock -> nombre de serie Excel (cellule de date native, triable, soustraisable). */
export function excelDateSerial(iso: string): number | null {
  const days = dateToDays(iso);
  return days === null ? null : days + EXCEL_EPOCH_OFFSET_DAYS;
}

/** Datetime ISO -> nombre de serie Excel (fraction de jour = heure UTC, secondes comprises). */
export function excelDatetimeSerial(iso: string): number | null {
  const days = datetimeToDays(iso);
  return days === null ? null : days + EXCEL_EPOCH_OFFSET_DAYS;
}

/**
 * Transforme les valeurs des colonnes date/datetime en nombres de serie Excel pour l'ecriture
 * d'un classeur natif (L48). Ce que l'ecran CSV conserve en ISO, le classeur le chiffre. Une
 * valeur vide reste vide ; une valeur invalide reste TEXTE tel quel (jamais effacee, jamais 0).
 * Les autres colonnes (nombres, compteurs, indicatrices, textes) passent sans changement.
 */
export function withExcelDateSerials(
  table: ExportTable,
  temporalColumns: ReadonlyMap<string, 'date' | 'datetime'>,
): ExportTable {
  return {
    columns: table.columns,
    rows: table.rows.map((row) => {
      const copy = { ...row };
      for (const [column, kind] of temporalColumns) {
        const value = row[column];
        if (typeof value !== 'string' || value === '') continue;
        const serial = kind === 'datetime' ? excelDatetimeSerial(value) : excelDateSerial(value);
        if (serial !== null) copy[column] = serial;
      }
      return copy;
    }),
  };
}

function numericValue(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '' && NUMERIC_LITERAL.test(raw.trim())) {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Valeur d'un operande, ou `null` pour ABSENTE. Un operande absent, ou porteur de l'un des
 * cinq codes de valeur manquante, rend le resultat absent — jamais zero. Un zero fabrique
 * se lirait comme une mesure, et fausserait toute moyenne calculee ensuite.
 */
function operandValue(
  operand: FormulaOperand,
  data: Record<string, unknown> | null | undefined,
  byKey: ReadonlyMap<string, FormulaFieldRef>,
): number | null {
  if (operand.kind === 'literal') return operand.value;
  const ref = byKey.get(operand.fieldKey);
  if (!ref) return null;
  const raw = data ? data[operand.fieldKey] : undefined;
  if (raw === null || raw === undefined || raw === '') return null;
  // Les cinq codes de L33 : `non_fait`, `inconnu`, `non_applicable`, `refus`, `non_documente`.
  if (typeof raw === 'object' && MISSING_KEY in (raw as Record<string, unknown>)) return null;
  if (ref.type === 'date') return dateToDays(raw);
  if (ref.type === 'datetime') return datetimeToDays(raw);
  return numericValue(raw);
}

// Le calcul binaire fabrique des chiffres qui n'ont pas ete mesures : 0,1 + 0,2 y vaut
// 0,30000000000000004. On arrondit pour EFFACER cet artefact, pas pour inventer une
// precision — au-dela de cette taille, l'arrondi lui-meme deviendrait faux.
const FORMULA_DECIMALS = 6;
const FORMULA_SAFE_SCALE = 1e15;
function stripBinaryNoise(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) >= FORMULA_SAFE_SCALE) return value;
  const factor = 10 ** FORMULA_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Evalue une formule sur une fiche. `null` = resultat ABSENT, la seule reponse possible
 * quand un operande manque, porte un code de valeur manquante, ou qu'on divise par zero :
 * ni erreur, ni infini, ni zero.
 */
export function evaluateFormula(
  parsed: ParsedFormula,
  data: Record<string, unknown> | null | undefined,
  byKey: ReadonlyMap<string, FormulaFieldRef>,
  resultUnit?: string | null,
): number | null {
  const temporalOperands = [parsed.left, parsed.right].filter((
    operand,
  ): operand is { kind: 'field'; fieldKey: string } =>
    operand.kind === 'field' &&
    (byKey.get(operand.fieldKey)?.type === 'date' || byKey.get(operand.fieldKey)?.type === 'datetime')
  );
  if (temporalOperands.length === 2 && parsed.operator !== '-') return null;
  const left = operandValue(parsed.left, data, byKey);
  if (left === null) return null;
  const right = operandValue(parsed.right, data, byKey);
  if (right === null) return null;
  let result: number;
  switch (parsed.operator) {
    case '+':
      result = left + right;
      break;
    case '-':
      result = left - right;
      break;
    case '*':
      result = left * right;
      break;
    case '/':
      // Division par zero : resultat ABSENT. Ni erreur qui bloquerait tout l'export, ni
      // infini qui se lirait comme une valeur.
      if (right === 0) return null;
      result = left / right;
      break;
  }
  if (!Number.isFinite(result)) return null;
  if (temporalOperands.length === 2) result *= FORMULA_TIME_UNIT_FACTORS[normalizeFormulaTimeUnit(resultUnit)];
  if (!Number.isFinite(result)) return null;
  return stripBinaryNoise(result);
}

/**
 * Variable calculee : dans sa propre version, ou dans l'une des versions unies par
 * `mergeExportFields`. Une colonne devenue calculee en v2 reste une colonne calculee du
 * point de vue du dictionnaire, meme si les fiches v1 y portent encore une valeur saisie.
 */
export const isCalculatedField = (
  field: Pick<ExportField, 'formula' | 'formulaByVersion'>,
): boolean => Boolean(field.formula) || Object.keys(field.formulaByVersion ?? {}).length > 0;

/** Formule applicable A CETTE FICHE : celle de SA version, sinon celle de la variable. */
export const formulaForVersion = (
  field: Pick<ExportField, 'formula' | 'formulaByVersion'>,
  versionId: string | undefined,
): string | null => {
  const byVersion = field.formulaByVersion;
  if (versionId && byVersion && Object.keys(byVersion).length > 0) {
    return byVersion[versionId] ?? null;
  }
  return field.formula ?? null;
};

/** Unite applicable a CETTE fiche ; les formules versionnees peuvent changer d unite. */
export const formulaUnitForVersion = (
  field: Pick<ExportField, 'unit' | 'formulaUnitByVersion'>,
  versionId: string | undefined,
): string | null => {
  const byVersion = field.formulaUnitByVersion;
  if (versionId && byVersion && Object.prototype.hasOwnProperty.call(byVersion, versionId)) {
    return byVersion[versionId] ?? null;
  }
  return field.unit ?? null;
};

/** Meme chose depuis le texte stocke : le chemin qu'empruntent l'ecran et l'export. */
export function evaluateFormulaText(
  text: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
  byKey: ReadonlyMap<string, FormulaFieldRef>,
  resultUnit?: string | null,
): number | null {
  const parsed = parseFormula(text);
  return parsed ? evaluateFormula(parsed, data, byKey, resultUnit) : null;
}

const codeOf = (v: unknown): string => {
  if (isTerminologyValue(v)) return v.code;
  if (isTerminologyList(v)) return v.map((item) => item.code).join('; ');
  return '';
};

const nbOf = (field: ExportField, v: unknown): number | '' => {
  if (v === null || v === undefined || v === '') return '';
  if (missingCodeOf(v)) return field.type === 'multiselect' ? 0 : '';
  if (field.type === 'multiselect') {
    return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string').length : '';
  }
  if (isTerminologyList(v)) return v.length;
  if (isTerminologyValue(v)) return 1;
  return '';
};

/**
 * Colonnes d'un jeu de champs : un champ de terminologie en occupe deux (ou trois si multivalué),
 * une liste contrôlée deux, et un multiselect ajoute son nombre avant les indicatrices.
 *
 * En profil `analysis` (L46), un `select` simple ne rend QU'UNE colonne : elle porte le code
 * stable, le libellé ne se répète pas sur chaque ligne et vit une seule fois dans `Modalités`.
 */
export const columnsForFields = (fields: ExportField[], profile: ExportProfile = 'complete'): string[] =>
  fields.flatMap((f) => {
    // L35 : une variable calculee rend UNE colonne, comme le nombre qu'elle produit. Elle
    // n'a ni code, ni liste de modalites, ni indicatrices — il n'y a rien a coder.
    if (isCalculatedField(f)) return [columnId(f)];
    if (f.type === 'terminology') {
      if (f.isMultiple) {
        return [columnId(f), codeColumnId(f), nbColumnId(f)];
      }
      return [columnId(f), codeColumnId(f)];
    }
    if (f.type === 'multiselect') {
      // L47 : en Analyse, un multiselect ne rend QUE ses indicatrices binaires : ni libelle ni
      // codes concatenes, ni compteur — ces formes sont celles du profil `complete`.
      return profile === 'analysis' ? [] : [columnId(f), optionCodeColumnId(f), nbColumnId(f)];
    }
    // L46 : en Analyse, le select simple porte UNIQUEMENT son code stable dans la colonne
    // principale, et le libelle vit en une fois dans `Modalites`.
    if (isOptionList(f)) return profile === 'analysis' ? [columnId(f)] : [columnId(f), optionCodeColumnId(f)];
    return [columnId(f)];
  });

/** Union de deux listes d'options sur le code, la premiere rencontree fixant le libelle. */
function mergeOptionLists(a: unknown[] | null | undefined, b: unknown[] | null | undefined): unknown[] | null {
  if (!Array.isArray(a)) return Array.isArray(b) ? b : (a ?? null);
  if (!Array.isArray(b)) return a;
  const seen = new Set(
    a.map((o) => (o && typeof o === 'object' ? (o as RawOption).value_key : undefined))
      .filter((k): k is string => typeof k === 'string'),
  );
  const extra = b.filter((o) => {
    const key = o && typeof o === 'object' ? (o as RawOption).value_key : undefined;
    return typeof key === 'string' && !seen.has(key);
  });
  return extra.length ? [...a, ...extra] : a;
}

/**
 * Formule d'une variable, rattachee a chacune des versions ou elle s'applique. Une variable
 * sans formule n'en produit aucune : une colonne saisie reste saisie.
 */
function formulaEntries(field: ExportField): Record<string, string> {
  const entries: Record<string, string> = { ...field.formulaByVersion };
  if (field.formula) {
    for (const versionId of field.templateVersionIds ?? []) entries[versionId] = field.formula;
  }
  return entries;
}

/** Meme rattachement par version pour l unite de restitution. */
function formulaUnitEntries(field: ExportField): Record<string, string | null> {
  const entries: Record<string, string | null> = { ...field.formulaUnitByVersion };
  if (field.formula) {
    for (const versionId of field.templateVersionIds ?? []) entries[versionId] = field.unit;
  }
  return entries;
}

/** Unionne scope+field_key : une cle reste une variable malgre un renommage. */
export function mergeExportFields(input: ExportField[]): ExportField[] {
  // D13 : préserver l'ordre du formulaire (scope -> display_order -> fieldKey)
  const sorted = [...input].sort((a, b) =>
    a.scope.localeCompare(b.scope) ||
    (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
    a.fieldKey.localeCompare(b.fieldKey) ||
    a.label.localeCompare(b.label)
  );
  const merged = new Map<string, ExportField>();
  for (const field of sorted) {
    const key = columnId(field);
    const versions = field.templateVersionIds ?? [];
    const previous = merged.get(key);
    if (previous) {
      previous.templateVersionIds = [...new Set([...(previous.templateVersionIds ?? []), ...versions])].sort();
      previous.isMultiple = Boolean(previous.isMultiple || field.isMultiple);
      // Une colonne peut traverser plusieurs versions dont les raisons different. Le
      // dictionnaire doit couvrir TOUT ce que la colonne peut contenir, sinon il decrit
      // une version et laisse un code inexplique en face d'une fiche plus ancienne.
      previous.missingReasons = sortMissingReasons([
        ...(previous.missingReasons ?? []),
        ...(field.missingReasons ?? []),
      ]);
      // Meme raison pour les options : une colonne peut traverser plusieurs versions dont
      // les listes different. Le dictionnaire doit couvrir TOUT ce que la colonne peut
      // contenir, sinon un code lu dans une fiche ancienne ne s'explique nulle part.
      previous.allowedOptions = mergeOptionLists(previous.allowedOptions, field.allowedOptions);
      // L31 : une colonne peut traverser des versions dont l'une seulement porte le libelle
      // de section (version anterieure au lot, ou section detachee). On garde le premier
      // libelle connu plutot que de laisser la colonne sans nom lisible.
      previous.sectionLabel = previous.sectionLabel ?? field.sectionLabel;
      // L35 : la formule NE SE FUSIONNE PAS. Chaque version garde la sienne, sinon une
      // fiche v1 se verrait appliquer la formule corrigee en v2 — exactement ce que la
      // decision « la formule appartient a la version » interdit.
      previous.formulaByVersion = { ...previous.formulaByVersion, ...formulaEntries(field) };
      previous.formulaUnitByVersion = { ...previous.formulaUnitByVersion, ...formulaUnitEntries(field) };
    } else {
      merged.set(key, {
        ...field,
        isMultiple: Boolean(field.isMultiple),
        templateVersionIds: [...new Set(versions)].sort(),
        missingReasons: field.missingReasons ? sortMissingReasons(field.missingReasons) : field.missingReasons,
        formulaByVersion: formulaEntries(field),
        formulaUnitByVersion: formulaUnitEntries(field),
      });
    }
  }
  // D13 : tri final respectant l'ordre d'affichage
  return [...merged.values()].sort((a, b) =>
    a.scope.localeCompare(b.scope) ||
    (a.displayOrder ?? 0) - (b.displayOrder ?? 0) ||
    a.fieldKey.localeCompare(b.fieldKey)
  );
}

export function referencedTemplateVersions(patients: ExportPatient[], encounters: ExportEncounter[]): string[] {
  return [
    ...new Set([
      ...patients.map((p) => p.templateVersionId),
      ...encounters.map((e) => e.templateVersionId),
    ].filter((id): id is string => Boolean(id))),
  ].sort();
}

const EMPTY_FORMULA_INDEX: ReadonlyMap<string, FormulaFieldRef> = new Map();

const belongsToField = (versionId: string | undefined, field: ExportField) =>
  !versionId || !field.templateVersionIds?.length || field.templateVersionIds.includes(versionId);
const valueFor = (data: Record<string, unknown>, versionId: string | undefined, field: ExportField) =>
  belongsToField(versionId, field) ? formatValue(data[field.fieldKey], field.type) : '';

/** Renseigne la colonne du champ et ses colonnes analytiques derivees. */
function assignField(
  row: Record<string, unknown>,
  data: Record<string, unknown> | null,
  versionId: string | undefined,
  field: ExportField,
  /** Operandes possibles, de la MEME portee que `field` (L35). Vide ailleurs. */
  peers: ReadonlyMap<string, FormulaFieldRef> = EMPTY_FORMULA_INDEX,
  /** Profil d'export (L46) : le select simple rend son code stable en Analyse. */
  profile: ExportProfile = 'complete',
): void {
  const applicable = Boolean(data) && belongsToField(versionId, field);
  // L35 : rien n'est stocke sous cette cle, la colonne est RECALCULEE ici. La formule
  // retenue est celle de la version de LA FICHE, pas celle de la version courante.
  const formula = applicable ? formulaForVersion(field, versionId) : null;
  if (formula) {
    const value = evaluateFormulaText(formula, data, peers, formulaUnitForVersion(field, versionId));
    // Resultat absent -> cellule vide, jamais zero : un zero se lirait comme une mesure.
    row[columnId(field)] = value === null ? '' : value;
    return;
  }
  if (field.type === 'multiselect') {
    // L47 : en Analyse, la feuille principale ne porte pas les formes techniques du multiselect
    // (libelle/codes concatenes, compteur) ; seules les indicatrices, ecrites par l'appelant.
    if (profile === 'analysis') return;
    const cells = applicable ? optionCells(field, data![field.fieldKey]) : { label: '', code: '' };
    row[columnId(field)] = cells.label;
    row[optionCodeColumnId(field)] = cells.code;
    row[nbColumnId(field)] = applicable ? nbOf(field, data![field.fieldKey]) : '';
    return;
  }
  if (isOptionList(field)) {
    const cells = applicable ? optionCells(field, data![field.fieldKey]) : { label: '', code: '' };
    // L46 : en Analyse, la colonne principale porte le CODE stable. Le libellé ne se répète
    // pas sur chaque ligne ; il vit une seule fois dans la feuille `Modalités`. Une raison de
    // valeur manquante reste elle explicite (codage du dictionnaire), jamais effacée.
    if (profile === 'analysis') {
      const missing = applicable ? missingCodeOf(data![field.fieldKey]) : null;
      row[columnId(field)] = missing ?? cells.code;
      return;
    }
    // L30 : le libelle dans la colonne principale, le code dans la sienne. C'est le code
    // qui reste stable quand un libelle est corrige, donc lui qui permet de compter.
    row[columnId(field)] = cells.label;
    row[optionCodeColumnId(field)] = cells.code;
    return;
  }
  row[columnId(field)] = data ? valueFor(data, versionId, field) : '';
  if (field.type !== 'terminology') return;
  row[codeColumnId(field)] = applicable ? codeOf(data![field.fieldKey]) : '';
  if (field.isMultiple) {
    row[nbColumnId(field)] = applicable ? nbOf(field, data![field.fieldKey]) : '';
  }
}

const formatAgeValue = (raw: unknown): unknown => {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && NUMERIC_LITERAL.test(raw)) {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
  }
  return formatValue(raw);
};

export const MAX_INDICATOR_CODES = 100;

export function normalizeIndicatorSuffix(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'code';
}

export interface IndicatorMeta {
  columnId: string;
  field: ExportField;
  code: string;
  label: string;
}

interface MultivalueEntry {
  code: string;
  label: string;
}

/** Enumere une liste de terminologie ou les codes bruts d'un multiselect. */
const multivalueEntriesOf = (field: ExportField, value: unknown): MultivalueEntry[] => {
  if (field.type === 'multiselect') {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((code) => ({ code, label: labelOfOption(field, code) }));
  }
  if (isTerminologyList(value)) return value;
  if (isTerminologyValue(value)) return [value];
  return [];
};

export function extractMultivalueCodes(
  fields: ExportField[],
  dataRows: Array<{ data?: Record<string, unknown> | null; templateVersionId?: string }>,
): { indicatorsByField: Map<string, IndicatorMeta[]>; omittedFieldKeys: Set<string> } {
  const indicatorsByField = new Map<string, IndicatorMeta[]>();
  const omittedFieldKeys = new Set<string>();

  for (const f of fields.filter((field) => isMultivalueField(field))) {
    const rawCodes: string[] = [];
    const labelByCode = new Map<string, string>();

    for (const row of dataRows) {
      if (!row.data) continue;
      const val = row.data[f.fieldKey];
      for (const item of multivalueEntriesOf(f, val)) {
        rawCodes.push(item.code);
        if (!labelByCode.has(item.code)) labelByCode.set(item.code, item.label);
      }
    }

    const uniqueCodes = [...new Set(rawCodes)].sort();
    if (uniqueCodes.length > MAX_INDICATOR_CODES) {
      omittedFieldKeys.add(f.fieldKey);
      indicatorsByField.set(f.fieldKey, []);
    } else if (uniqueCodes.length > 0) {
      const indicators: IndicatorMeta[] = [];
      const seenSuffixes = new Map<string, number>();

      for (const code of uniqueCodes) {
        const baseNorm = normalizeIndicatorSuffix(code);
        const count = seenSuffixes.get(baseNorm) ?? 0;
        const norm = count > 0 ? `${baseNorm}_${count + 1}` : baseNorm;
        seenSuffixes.set(baseNorm, count + 1);

        indicators.push({
          columnId: `has__${columnId(f)}__${norm}`,
          field: f,
          code,
          label: labelByCode.get(code) ?? code,
        });
      }
      indicatorsByField.set(f.fieldKey, indicators);
    } else {
      indicatorsByField.set(f.fieldKey, []);
    }
  }

  return { indicatorsByField, omittedFieldKeys };
}

const hasCodeInValue = (field: ExportField, value: unknown, targetCode: string): boolean =>
  multivalueEntriesOf(field, value).some((item) => item.code === targetCode);

/**
 * Ecrit les indicatrices d'un champ multivalue (L22/L36, regles L47) :
 * - `1` si le code est selectionne ;
 * - `0` pour tout champ APPLICABLE sans cette modalite (liste vide ou non selectionnee) ;
 * - cellule vide seulement quand le champ n'est pas applicable (absent de la version de la fiche) ;
 * - une raison explicite de valeur manquante suit le codage du dictionnaire et ne devient
 *   jamais une selection (toutes les indicatrices a `0`).
 * En `complete`, une valeur absente sur un champ applicable reste `''` pour preserver
 * strictement le comportement anterieur au lot.
 */
function assignIndicators(
  row: Record<string, unknown>,
  field: ExportField,
  indicators: IndicatorMeta[],
  data: Record<string, unknown> | null | undefined,
  versionId: string | undefined,
  profile: ExportProfile,
): void {
  const applicable = Boolean(data) && belongsToField(versionId, field);
  for (const ind of indicators) {
    if (!applicable || !data) {
      row[ind.columnId] = '';
    } else if (data[field.fieldKey] === undefined) {
      row[ind.columnId] = profile === 'analysis' ? 0 : '';
    } else if (missingCodeOf(data[field.fieldKey])) {
      row[ind.columnId] = 0;
    } else {
      row[ind.columnId] = hasCodeInValue(field, data[field.fieldKey], ind.code) ? 1 : 0;
    }
  }
}

const ENCOUNTER_META = ['patient_code', 'encounter_id', 'encounter_date', 'encounter_type', 'age_value', 'age_unit'];
export function buildEncounterExport(
  encounters: ExportEncounter[],
  fields: ExportField[],
  profile: ExportProfile = 'complete',
): ExportTable {
  const encFields = mergeExportFields(fields).filter((f) => f.scope === 'encounter');
  const { indicatorsByField } = extractMultivalueCodes(encFields, encounters);
  // L35 : les operandes d'une variable calculee sont de la MEME portee — l'index ne
  // contient donc que les variables de rencontre, et il est construit une seule fois.
  const encPeers = formulaFieldIndex(encFields);

  const columns = [
    ...ENCOUNTER_META,
    ...encFields.flatMap((f) => {
      const base = columnsForFields([f], profile);
      const inds = (indicatorsByField.get(f.fieldKey) ?? []).map((i) => i.columnId);
      return [...base, ...inds];
    }),
  ];

  const rows = [...encounters].sort((a, b) =>
    a.patientCode.localeCompare(b.patientCode) || a.encounterDate.localeCompare(b.encounterDate) ||
    a.id.localeCompare(b.id)
  ).map((e) => {
    const row: Record<string, unknown> = {
      patient_code: e.patientCode,
      encounter_id: e.id,
      encounter_date: e.encounterDate,
      encounter_type: e.encounterType,
      age_value: formatAgeValue(e.ageValue ?? e.data.age_at_encounter),
      age_unit: e.ageUnit ?? '',
    };
    for (const f of encFields) {
      assignField(row, e.data, e.templateVersionId, f, encPeers, profile);
      assignIndicators(row, f, indicatorsByField.get(f.fieldKey) ?? [], e.data, e.templateVersionId, profile);
    }
    return row;
  });
  return { columns, rows };
}

const pickEncounter = (encounters: ExportEncounter[], rule: AggregationRule) => {
  const sorted = [...encounters].sort((a, b) =>
    a.encounterDate.localeCompare(b.encounterDate) || a.id.localeCompare(b.id)
  );
  return sorted.length ? (rule === 'first' ? sorted[0] : sorted[sorted.length - 1]) : null;
};
export function buildPatientExport(
  patients: ExportPatient[],
  encounters: ExportEncounter[],
  fields: ExportField[],
  rule: AggregationRule,
  profile: ExportProfile = 'complete',
): ExportTable {
  const all = mergeExportFields(fields);
  const patientFields = all.filter((f) => f.scope === 'patient');
  const encounterFields = all.filter((f) => f.scope === 'encounter');

  const { indicatorsByField: patIndicators } = extractMultivalueCodes(patientFields, patients);
  const { indicatorsByField: encIndicators } = extractMultivalueCodes(encounterFields, encounters);
  // L35 : un index d'operandes PAR PORTEE. Une variable calculee permanente ne lit que des
  // donnees permanentes, une variable de rencontre que des donnees de rencontre.
  const patPeers = formulaFieldIndex(patientFields);
  const encPeers = formulaFieldIndex(encounterFields);

  const patientCols = patientFields.flatMap((f) => {
    const base = columnsForFields([f], profile);
    const inds = (patIndicators.get(f.fieldKey) ?? []).map((i) => i.columnId);
    return [...base, ...inds];
  });
  const encounterCols = encounterFields.flatMap((f) => {
    const base = columnsForFields([f], profile);
    const inds = (encIndicators.get(f.fieldKey) ?? []).map((i) => i.columnId);
    return [...base, ...inds];
  });

  const columns = [
    'patient_code',
    ...patientCols,
    'age_value',
    'age_unit',
    ...encounterCols,
  ];

  const byPatient = new Map<string, ExportEncounter[]>();
  for (const e of encounters) byPatient.set(e.patientCode, [...(byPatient.get(e.patientCode) ?? []), e]);
  const rows = [...patients].sort((a, b) => a.code.localeCompare(b.code)).map((p) => {
    const row: Record<string, unknown> = { patient_code: p.code };
    for (const f of patientFields) {
      assignField(row, p.data, p.templateVersionId, f, patPeers, profile);
      assignIndicators(row, f, patIndicators.get(f.fieldKey) ?? [], p.data, p.templateVersionId, profile);
    }
    const e = pickEncounter(byPatient.get(p.code) ?? [], rule);
    row.age_value = e ? formatAgeValue(e.ageValue ?? e.data.age_at_encounter) : '';
    row.age_unit = e?.ageUnit ?? '';
    for (const f of encounterFields) {
      assignField(row, e ? e.data : null, e?.templateVersionId, f, encPeers, profile);
      assignIndicators(row, f, encIndicators.get(f.fieldKey) ?? [], e?.data, e?.templateVersionId, profile);
    }
    return row;
  });
  return { columns, rows };
}

/** Construit la feuille dédiée pour un champ multivalué (L22/L36 §7.3). */
export function buildMultivalueTable(
  field: ExportField,
  patients: ExportPatient[],
  encounters: ExportEncounter[],
): ExportTable {
  const columns = ['patient_code', 'encounter_id', 'rang', 'code', 'label'];
  const rows: Record<string, unknown>[] = [];

  const appendRows = (patientCode: string, encounterId: string, raw: unknown) => {
    for (const [index, item] of multivalueEntriesOf(field, raw).entries()) {
      rows.push({
        patient_code: patientCode,
        encounter_id: encounterId,
        rang: index + 1,
        code: item.code,
        label: item.label,
      });
    }
  };

  if (field.scope === 'patient') {
    const sortedPatients = [...patients].sort((a, b) => a.code.localeCompare(b.code));
    for (const p of sortedPatients) {
      const raw = p.data ? p.data[field.fieldKey] : null;
      appendRows(p.code, '', raw);
    }
  } else {
    const sortedEncounters = [...encounters].sort((a, b) =>
      a.patientCode.localeCompare(b.patientCode) || a.encounterDate.localeCompare(b.encounterDate) ||
      a.id.localeCompare(b.id)
    );
    for (const e of sortedEncounters) {
      const raw = e.data ? e.data[field.fieldKey] : null;
      appendRows(e.patientCode, e.id, raw);
    }
  }

  return { columns, rows };
}

/**
 * Feuille `Modalités` (L46) : documente une fois chaque option d'une liste controlee
 * (`select`/`multiselect`), pour qu'une ligne de `Données` reste lisible sans recodage. Une
 * ligne par option, un seul libellé — meme quand le libellé a été corrigé d'une version à
 * l'autre, c'est le code qui identifie la modalité. Variable rangee par `analyticId`, ordre de
 * la liste fusionnée, état actif du dernier gabarit qui la porte. La terminologie n'a pas de
 * liste contrôlée : ses codes libres restent documentés par le dictionnaire et la feuille
 * longue, pas ici.
 */
export function buildModalities(fields: ExportField[]): ExportTable {
  const columns = ['variable', 'code', 'label', 'order', 'is_active'];
  const rows: Record<string, unknown>[] = [];
  for (const field of mergeExportFields(fields)) {
    if (!isOptionList(field)) continue;
    optionsOf(field).forEach((option, index) => {
      rows.push({
        variable: analyticId(field),
        code: option.key,
        label: option.label,
        order: index + 1,
        is_active: option.isActive ? 'true' : 'false',
      });
    });
  }
  return { columns, rows };
}

export interface DictionaryOptions {
  indicatorsByField?: Map<string, IndicatorMeta[]>;
  omittedFieldKeys?: Set<string>;
  // L49 : le profil Analyse porte un dictionnaire reduit aux proprietes d'interpretation ; le
  // profil `complete` conserve le dictionnaire detaille historique (versions, portee, multiplicite).
  profile?: 'analysis' | 'complete';
}

/**
 * Formule(s) d'une colonne, pour le dictionnaire. Une colonne peut traverser des versions
 * dont les formules different : le dictionnaire les cite TOUTES, comme il cite deja toutes
 * les raisons de valeur manquante — sans quoi il decrirait une version et laisserait un
 * resultat inexplique en face d'une fiche plus ancienne.
 */
function formulaLabel(field: ExportField): string {
  const all = Object.values(field.formulaByVersion ?? {});
  if (field.formula) all.push(field.formula);
  return [...new Set(all)].sort().join('; ');
}

// L49 : dans `analysis`, le dictionnaire ne garde que ce qui sert a LIRE le fichier : la
// variable (colonne exacte), son libelle, sa description, sa section et son type, son unite,
// sa formule, ses valeurs autorisees (le cas echeant avec mention `(inactif)`) et les raisons
// de valeur manquante. La portee (`scope`) se lit dans le prefixe de la variable ; les
// versions de gabarit migrent vers la feuille `Métadonnées`.
const ANALYSIS_DICTIONARY_COLUMNS = [
  'column_id',
  'label',
  'description',
  'section',
  'section_label',
  'type',
  'unit',
  'formula',
  'allowed_values',
  'missing_reasons',
];

const DETAILED_DICTIONARY_COLUMNS = [
  'column_id',
  'field_key',
  'label',
  'description',
  'scope',
  'section',
  'section_label',
  'type',
  // L35 : une colonne calculee doit dire COMMENT elle a ete obtenue. Sans cette colonne,
  // le fichier exporte porte un nombre que rien n'explique, et qui n'est nulle part dans
  // les donnees brutes puisqu'il n'est jamais stocke.
  'formula',
  'is_multiple',
  'unit',
  'allowed_values',
  'missing_reasons',
  'template_versions',
];

export function buildDictionary(fields: ExportField[], options?: DictionaryOptions): ExportTable {
  const isAnalysis = options?.profile === 'analysis';
  const columns = isAnalysis ? ANALYSIS_DICTIONARY_COLUMNS : DETAILED_DICTIONARY_COLUMNS;
  return {
    columns,
    rows: mergeExportFields(fields).flatMap((f) => {
      const optionsList = isOptionList(f) ? optionsOf(f) : [];
      const common = {
        description: f.description ?? '',
        section: f.section,
        section_label: f.sectionLabel ?? '',
        unit: f.unit ?? '',
        allowed_values: isOptionList(f)
          ? optionsList.map((o) => (o.isActive ? o.label : `${o.label} (inactif)`)).join('; ')
          : Array.isArray(f.allowedValues)
          ? f.allowedValues.join('; ')
          : '',
        missing_reasons: (f.missingReasons ?? []).join('; '),
        ...(isAnalysis ? {} : {
          field_key: f.fieldKey,
          scope: f.scope,
          is_multiple: f.isMultiple ? 'true' : 'false',
          template_versions: (f.templateVersionIds ?? []).join('; '),
        }),
        // Les colonnes derivees (code, nombre, indicatrices) ne sont pas calculees par une
        // formule d'utilisateur : la case reste vide chez elles.
        formula: '',
      };
      const valueRow = { column_id: columnId(f), label: f.label, type: f.type, ...common, formula: formulaLabel(f) };
      const derivedRows: Record<string, unknown>[] = [];
      if (isMultivalueField(f)) {
        // L47/L49 : en Analyse, le multiselect n'a NI colonne `option_code` NI colonne `nb` :
        // seule l'indicatrice existe, et c'est elle seule que le dictionnaire documente ici.
        const hasCountColumn = !(isAnalysis && f.type === 'multiselect');
        if (hasCountColumn) {
          derivedRows.push({
            ...common,
            column_id: nbColumnId(f),
            label: `${f.label} — nombre`,
            type: 'computed_count',
            formula: '',
          });
        }

        const indicators = options?.indicatorsByField?.get(f.fieldKey) ?? [];
        for (const ind of indicators) {
          derivedRows.push({
            ...common,
            column_id: ind.columnId,
            label: `${f.label} — ${ind.label}`,
            type: 'computed_indicator',
            allowed_values: ind.code,
          });
        }
        if (options?.omittedFieldKeys?.has(f.fieldKey)) {
          derivedRows.push({
            ...common,
            column_id: `has__${columnId(f)}`,
            label: `${f.label} — indicateurs (>100 codes, voir feuille dédiée)`,
            type: 'computed_indicator_omitted',
          });
        }
      }
      if (isOptionList(f)) {
        return [
          valueRow,
          // L49 : en `analysis`, la colonne principale du select/multiselect porte deja le
          // code stable et le libelle vit dans `Modalités` — pas de colonne `option_code__`.
          ...(isAnalysis ? [] : [{
            ...common,
            column_id: optionCodeColumnId(f),
            label: `${f.label} — code`,
            type: `${f.type}_code`,
            allowed_values: optionsList.map((o) => o.key).join('; '),
          }]),
          ...derivedRows,
        ];
      }
      if (f.type !== 'terminology') return [valueRow];
      return [
        valueRow,
        {
          ...common,
          column_id: codeColumnId(f),
          label: `${f.label} — code`,
          type: 'terminology_code',
          allowed_values: '',
        },
        ...derivedRows,
      ];
    }),
  };
}

export interface MetadataInput {
  profile: 'analysis' | 'complete';
  generatedAt: string;
  baseName: string;
  cohortName: string;
  mode: 'encounter' | 'patient';
  selectionRule: string;
  templateVersions: string[];
  rowCount: number;
  excludedPatientCount: number;
  excludedEncounterCount: number;
}

/**
 * L49 : feuille `Métadonnées` (profil Analyse). Les informations globales quittent le
 * dictionnaire pour rendre le classeur autonome : qui l'a produit, quand, sur quelle base et
 * quelle cohorte, quelles versions de gabarit, combien de lignes, quelles exclusions pile.
 * Le fichier interroge ne s'explique pas seulement par ses colonnes, mais par ce qu'il a laisse
 * de cote — les exclusions restent comptees et motivables.
 */
export function buildMetadata(input: MetadataInput): ExportTable {
  const rows: Record<string, unknown>[] = [];
  const add = (attribute: string, value: unknown) => rows.push({ attribute, value });
  add('export_profile', input.profile);
  add('generated_at', input.generatedAt);
  add('base_name', input.baseName);
  add('cohort_name', input.cohortName);
  add('export_mode', input.mode);
  add('selection_rule', input.selectionRule);
  add('template_versions', input.templateVersions.join('; '));
  add('row_count', input.rowCount);
  add('excluded_patients_incomplete', input.excludedPatientCount);
  add('excluded_encounters_incomplete', input.excludedEncounterCount);
  return { columns: ['attribute', 'value'], rows };
}

const NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Apostrophe Excel : neutralise une formule, mais preserve les litteraux numeriques signes. */
export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/.test(value) && !NUMERIC_LITERAL.test(value) ? `'${value}` : value;
}

/** Applique le meme contrat anti-formule aux cellules XLSX qu'aux cellules CSV. */
export function neutralizeExportTable(table: ExportTable): ExportTable {
  return {
    columns: [...table.columns],
    rows: table.rows.map((row) =>
      Object.fromEntries(table.columns.map((column) => {
        const value = row[column];
        return [column, typeof value === 'string' ? neutralizeSpreadsheetFormula(value) : value];
      }))
    ),
  };
}
function csvCell(value: unknown): string {
  const s = neutralizeSpreadsheetFormula(value === null || value === undefined ? '' : String(value));
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(table: ExportTable): string {
  assertNoIdentity(table.columns);
  return [
    table.columns.map(csvCell).join(','),
    ...table.rows.map((r) => table.columns.map((c) => csvCell(r[c])).join(',')),
  ].join('\n');
}
