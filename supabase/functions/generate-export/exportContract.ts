// Contrat pur partage entre le navigateur (tests de domaine) et l'Edge Function.
// Les noms de colonnes sont volontairement des identifiants stables, jamais des labels.
export type AggregationRule = 'first' | 'last';

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
 * Colonne du CODE d'un champ de terminologie. Le libelle part dans la colonne principale
 * pour la lecture, le code dans celle-ci pour l'analyse : c'est lui qui reste stable quand
 * un libelle est corrige, et donc lui qui permet de regrouper sans scinder une maladie.
 */
export const codeColumnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `terminology_code__${columnId(field)}`;

/**
 * Colonne du NOMBRE d'elements d'une variable multivaluee (L22).
 */
export const nbColumnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `nb__${columnId(field)}`;

/**
 * Colonne du CODE d'une liste controlee (L30) — meme convention que la terminologie, et
 * pour la meme raison : le libelle part dans la colonne principale pour la lecture, le
 * code dans celle-ci pour l'analyse. C'est le code qui reste stable quand un libelle est
 * corrige, donc lui qui permet de regrouper sans scinder une modalite en deux.
 */
export const optionCodeColumnId = (field: Pick<ExportField, 'scope' | 'fieldKey'>) => `option_code__${columnId(field)}`;

const isOptionList = (field: Pick<ExportField, 'type'>) => field.type === 'select' || field.type === 'multiselect';

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
 * Types de variables admissibles comme operande. `datetime` en est volontairement absent :
 * une difference d'horodatages ne rend pas un nombre ENTIER de jours, et le type de sortie
 * cesserait d'etre deductible.
 */
export const FORMULA_OPERAND_TYPES = ['number', 'integer', 'date'] as const;

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

const isDateRef = (ref: FormulaFieldRef) => ref.type === 'date';

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

  const dates = refs.filter((r) => r !== null && isDateRef(r));
  if (dates.length === 2) {
    // La SEULE operation admise entre deux dates, et elle rend des jours entiers.
    if (parsed.operator !== '-') return { ok: false, problem: 'operator_type' };
    return { ok: true, parsed, outputType: 'integer' };
  }
  // Une date melangee a un nombre n'a pas de sens ici : « date + 3 » demanderait de decider
  // si 3 est un jour, un mois ou une heure. On refuse plutot que de choisir a sa place.
  if (dates.length === 1) return { ok: false, problem: 'operator_type' };
  return { ok: true, parsed, outputType: 'number' };
}

/** Index des operandes, construit UNE fois par export plutot qu'a chaque ligne. */
export const formulaFieldIndex = (
  fields: readonly FormulaFieldRef[],
): Map<string, FormulaFieldRef> => new Map(fields.map((f) => [f.fieldKey, f]));

const MS_PER_DAY = 86_400_000;

/** Date stockee -> jours depuis l'epoque. Une date invalide vaut ABSENTE, jamais zero. */
function dateToDays(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // 2024-02-31 n'existe pas : `Date.UTC` la deplacerait en mars sans rien dire.
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    return null;
  }
  return ms / MS_PER_DAY;
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
  return isDateRef(ref) ? dateToDays(raw) : numericValue(raw);
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
): number | null {
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

/** Meme chose depuis le texte stocke : le chemin qu'empruntent l'ecran et l'export. */
export function evaluateFormulaText(
  text: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
  byKey: ReadonlyMap<string, FormulaFieldRef>,
): number | null {
  const parsed = parseFormula(text);
  return parsed ? evaluateFormula(parsed, data, byKey) : null;
}

const codeOf = (v: unknown): string => {
  if (isTerminologyValue(v)) return v.code;
  if (isTerminologyList(v)) return v.map((item) => item.code).join('; ');
  return '';
};

const nbOf = (v: unknown): number | '' => {
  if (v === null || v === undefined || v === '') return '';
  if (missingCodeOf(v)) return '';
  if (isTerminologyList(v)) return v.length;
  if (isTerminologyValue(v)) return 1;
  return '';
};

/**
 * Colonnes d'un jeu de champs : un champ de terminologie en occupe deux (ou trois si multivalué),
 * une liste contrôlée deux.
 */
export const columnsForFields = (fields: ExportField[]): string[] =>
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
    if (isOptionList(f)) return [columnId(f), optionCodeColumnId(f)];
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
    } else {
      merged.set(key, {
        ...field,
        isMultiple: Boolean(field.isMultiple),
        templateVersionIds: [...new Set(versions)].sort(),
        missingReasons: field.missingReasons ? sortMissingReasons(field.missingReasons) : field.missingReasons,
        formulaByVersion: formulaEntries(field),
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

/** Renseigne la colonne du champ, et celle du code lorsqu'il s'agit d'une terminologie. */
function assignField(
  row: Record<string, unknown>,
  data: Record<string, unknown> | null,
  versionId: string | undefined,
  field: ExportField,
  /** Operandes possibles, de la MEME portee que `field` (L35). Vide ailleurs. */
  peers: ReadonlyMap<string, FormulaFieldRef> = EMPTY_FORMULA_INDEX,
): void {
  const applicable = Boolean(data) && belongsToField(versionId, field);
  // L35 : rien n'est stocke sous cette cle, la colonne est RECALCULEE ici. La formule
  // retenue est celle de la version de LA FICHE, pas celle de la version courante.
  const formula = applicable ? formulaForVersion(field, versionId) : null;
  if (formula) {
    const value = evaluateFormulaText(formula, data, peers);
    // Resultat absent -> cellule vide, jamais zero : un zero se lirait comme une mesure.
    row[columnId(field)] = value === null ? '' : value;
    return;
  }
  if (isOptionList(field)) {
    // L30 : le libelle dans la colonne principale, le code dans la sienne. C'est le code
    // qui reste stable quand un libelle est corrige, donc lui qui permet de compter.
    const cells = applicable ? optionCells(field, data![field.fieldKey]) : { label: '', code: '' };
    row[columnId(field)] = cells.label;
    row[optionCodeColumnId(field)] = cells.code;
    return;
  }
  row[columnId(field)] = data ? valueFor(data, versionId, field) : '';
  if (field.type !== 'terminology') return;
  row[codeColumnId(field)] = applicable ? codeOf(data![field.fieldKey]) : '';
  if (field.isMultiple) {
    row[nbColumnId(field)] = applicable ? nbOf(data![field.fieldKey]) : '';
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

export function extractMultivalueCodes(
  fields: ExportField[],
  dataRows: Array<{ data?: Record<string, unknown> | null; templateVersionId?: string }>,
): { indicatorsByField: Map<string, IndicatorMeta[]>; omittedFieldKeys: Set<string> } {
  const indicatorsByField = new Map<string, IndicatorMeta[]>();
  const omittedFieldKeys = new Set<string>();

  for (const f of fields.filter((field) => field.isMultiple)) {
    const rawCodes: string[] = [];
    const labelByCode = new Map<string, string>();

    for (const row of dataRows) {
      if (!row.data) continue;
      const val = row.data[f.fieldKey];
      if (isTerminologyList(val)) {
        for (const item of val) {
          rawCodes.push(item.code);
          if (!labelByCode.has(item.code)) labelByCode.set(item.code, item.label);
        }
      } else if (isTerminologyValue(val)) {
        rawCodes.push(val.code);
        if (!labelByCode.has(val.code)) labelByCode.set(val.code, val.label);
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

const hasCodeInValue = (v: unknown, targetCode: string): boolean => {
  if (isTerminologyList(v)) return v.some((item) => item.code === targetCode);
  if (isTerminologyValue(v)) return v.code === targetCode;
  return false;
};

const ENCOUNTER_META = ['patient_code', 'encounter_id', 'encounter_date', 'encounter_type', 'age_value', 'age_unit'];
export function buildEncounterExport(encounters: ExportEncounter[], fields: ExportField[]): ExportTable {
  const encFields = mergeExportFields(fields).filter((f) => f.scope === 'encounter');
  const { indicatorsByField } = extractMultivalueCodes(encFields, encounters);
  // L35 : les operandes d'une variable calculee sont de la MEME portee — l'index ne
  // contient donc que les variables de rencontre, et il est construit une seule fois.
  const encPeers = formulaFieldIndex(encFields);

  const columns = [
    ...ENCOUNTER_META,
    ...encFields.flatMap((f) => {
      const base = columnsForFields([f]);
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
      assignField(row, e.data, e.templateVersionId, f, encPeers);
      const indicators = indicatorsByField.get(f.fieldKey) ?? [];
      const applicable = Boolean(e.data) && belongsToField(e.templateVersionId, f);
      for (const ind of indicators) {
        if (!applicable || !e.data || e.data[f.fieldKey] === undefined) {
          row[ind.columnId] = '';
        } else if (missingCodeOf(e.data[f.fieldKey])) {
          row[ind.columnId] = 0;
        } else {
          row[ind.columnId] = hasCodeInValue(e.data[f.fieldKey], ind.code) ? 1 : 0;
        }
      }
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
    const base = columnsForFields([f]);
    const inds = (patIndicators.get(f.fieldKey) ?? []).map((i) => i.columnId);
    return [...base, ...inds];
  });
  const encounterCols = encounterFields.flatMap((f) => {
    const base = columnsForFields([f]);
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
      assignField(row, p.data, p.templateVersionId, f, patPeers);
      const indicators = patIndicators.get(f.fieldKey) ?? [];
      const applicable = Boolean(p.data) && belongsToField(p.templateVersionId, f);
      for (const ind of indicators) {
        if (!applicable || !p.data || p.data[f.fieldKey] === undefined) {
          row[ind.columnId] = '';
        } else if (missingCodeOf(p.data[f.fieldKey])) {
          row[ind.columnId] = 0;
        } else {
          row[ind.columnId] = hasCodeInValue(p.data[f.fieldKey], ind.code) ? 1 : 0;
        }
      }
    }
    const e = pickEncounter(byPatient.get(p.code) ?? [], rule);
    row.age_value = e ? formatAgeValue(e.ageValue ?? e.data.age_at_encounter) : '';
    row.age_unit = e?.ageUnit ?? '';
    for (const f of encounterFields) {
      assignField(row, e ? e.data : null, e?.templateVersionId, f, encPeers);
      const indicators = encIndicators.get(f.fieldKey) ?? [];
      const applicable = Boolean(e?.data) && belongsToField(e?.templateVersionId, f);
      for (const ind of indicators) {
        if (!applicable || !e || !e.data || e.data[f.fieldKey] === undefined) {
          row[ind.columnId] = '';
        } else if (missingCodeOf(e.data[f.fieldKey])) {
          row[ind.columnId] = 0;
        } else {
          row[ind.columnId] = hasCodeInValue(e.data[f.fieldKey], ind.code) ? 1 : 0;
        }
      }
    }
    return row;
  });
  return { columns, rows };
}

/**
 * Construit la feuille dédiée pour un champ multivalué (L22 §7.3).
 */
export function buildMultivalueTable(
  field: ExportField,
  patients: ExportPatient[],
  encounters: ExportEncounter[],
): ExportTable {
  const columns = ['patient_code', 'encounter_id', 'rang', 'code', 'label'];
  const rows: Record<string, unknown>[] = [];

  if (field.scope === 'patient') {
    const sortedPatients = [...patients].sort((a, b) => a.code.localeCompare(b.code));
    for (const p of sortedPatients) {
      const raw = p.data ? p.data[field.fieldKey] : null;
      if (isTerminologyList(raw)) {
        raw.forEach((item, index) => {
          rows.push({
            patient_code: p.code,
            encounter_id: '',
            rang: index + 1,
            code: item.code,
            label: item.label,
          });
        });
      } else if (isTerminologyValue(raw)) {
        rows.push({
          patient_code: p.code,
          encounter_id: '',
          rang: 1,
          code: raw.code,
          label: raw.label,
        });
      }
    }
  } else {
    const sortedEncounters = [...encounters].sort((a, b) =>
      a.patientCode.localeCompare(b.patientCode) || a.encounterDate.localeCompare(b.encounterDate) ||
      a.id.localeCompare(b.id)
    );
    for (const e of sortedEncounters) {
      const raw = e.data ? e.data[field.fieldKey] : null;
      if (isTerminologyList(raw)) {
        raw.forEach((item, index) => {
          rows.push({
            patient_code: e.patientCode,
            encounter_id: e.id,
            rang: index + 1,
            code: item.code,
            label: item.label,
          });
        });
      } else if (isTerminologyValue(raw)) {
        rows.push({
          patient_code: e.patientCode,
          encounter_id: e.id,
          rang: 1,
          code: raw.code,
          label: raw.label,
        });
      }
    }
  }

  return { columns, rows };
}

export interface DictionaryOptions {
  indicatorsByField?: Map<string, IndicatorMeta[]>;
  omittedFieldKeys?: Set<string>;
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

export function buildDictionary(fields: ExportField[], options?: DictionaryOptions): ExportTable {
  const columns = [
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
  return {
    columns,
    rows: mergeExportFields(fields).flatMap((f) => {
      const optionsList = isOptionList(f) ? optionsOf(f) : [];
      const common = {
        field_key: f.fieldKey,
        description: f.description ?? '',
        scope: f.scope,
        section: f.section,
        section_label: f.sectionLabel ?? '',
        is_multiple: f.isMultiple ? 'true' : 'false',
        unit: f.unit ?? '',
        allowed_values: isOptionList(f)
          ? optionsList.map((o) => (o.isActive ? o.label : `${o.label} (inactif)`)).join('; ')
          : Array.isArray(f.allowedValues)
          ? f.allowedValues.join('; ')
          : '',
        missing_reasons: (f.missingReasons ?? []).join('; '),
        template_versions: (f.templateVersionIds ?? []).join('; '),
        // Les colonnes derivees (code, nombre, indicatrices) ne sont pas calculees par une
        // formule d'utilisateur : la case reste vide chez elles.
        formula: '',
      };
      const valueRow = { column_id: columnId(f), label: f.label, type: f.type, ...common, formula: formulaLabel(f) };
      if (isOptionList(f)) {
        return [
          valueRow,
          {
            ...common,
            column_id: optionCodeColumnId(f),
            label: `${f.label} — code`,
            type: `${f.type}_code`,
            is_multiple: 'false',
            unit: '',
            allowed_values: optionsList.map((o) => o.key).join('; '),
            missing_reasons: '',
          },
        ];
      }
      if (f.type !== 'terminology') return [valueRow];
      const result = [
        valueRow,
        {
          ...common,
          column_id: codeColumnId(f),
          label: `${f.label} — code`,
          type: 'terminology_code',
          is_multiple: 'false',
          unit: '',
          allowed_values: '',
          missing_reasons: '',
        },
      ];
      if (f.isMultiple) {
        result.push({
          ...common,
          column_id: nbColumnId(f),
          label: `${f.label} — nombre`,
          type: 'computed_count',
          is_multiple: 'false',
          unit: '',
          allowed_values: '',
          missing_reasons: '',
        });

        const indicators = options?.indicatorsByField?.get(f.fieldKey) ?? [];
        for (const ind of indicators) {
          result.push({
            ...common,
            column_id: ind.columnId,
            label: `${f.label} — ${ind.code}`,
            type: 'computed_indicator',
            is_multiple: 'false',
            unit: '',
            allowed_values: ind.code,
            missing_reasons: '',
          });
        }
        if (options?.omittedFieldKeys?.has(f.fieldKey)) {
          result.push({
            ...common,
            column_id: `has__${columnId(f)}`,
            label: `${f.label} — indicateurs (>100 codes, voir feuille dédiée)`,
            type: 'computed_indicator_omitted',
            is_multiple: 'false',
            unit: '',
            allowed_values: '',
            missing_reasons: '',
          });
        }
      }
      return result;
    }),
  };
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
