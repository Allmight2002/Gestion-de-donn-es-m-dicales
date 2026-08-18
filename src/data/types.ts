// DTO de l'admin gabarits (camelCase cote front).
// Import de TYPE uniquement : efface a la compilation, donc aucun cycle a l'execution.
import type { MissingCode } from '../domain/export';
import { displayOptionValue, type FieldOption } from '../domain/fieldOptions';

/**
 * Ce dont `displayFieldValue` a besoin pour rendre le libellé d'une option (L30).
 * `type` est optionnel : une colonne venant d'un instantané ancien peut ne pas le porter,
 * et l'absence doit se lire comme « pas une liste », jamais comme une erreur.
 */
interface OptionCarrier {
  type?: string;
  allowedOptions?: unknown;
  allowedValues?: unknown;
}

export type FieldScope = 'patient' | 'encounter';
/**
 * Code interne d'une section (L31). LIBRE : chaque base definit les siennes, un registre
 * de traumatisme cranien n'ayant pas les memes regroupements qu'un registre de cardiologie.
 *
 * Ce n'est PAS une categorie de donnee : c'est le regroupement visuel du formulaire. Le
 * libelle affiche vient de `TemplateSection`, jamais de ce code — sauf pour les trois codes
 * historiques, qui restent traduits (voir `domain/templateSections`).
 */
export type FieldSection = string;
export type FieldType =
  | 'number' | 'integer' | 'text' | 'date' | 'datetime' | 'boolean' | 'select' | 'multiselect'
  // Valeurs resolues dans le referentiel plutot que recopiees dans le gabarit.
  | 'terminology';

/**
 * Valeur d'un champ de terminologie : le CODE sert au comptage et survit a une correction
 * de libelle ; le LIBELLE est l'instantane pris a la saisie, qui garde la fiche lisible si
 * le referentiel change. Le serveur refuse un couple incoherent.
 */
export interface TerminologyValue {
  code: string;
  label: string;
}

export function isTerminologyValue(v: unknown): v is TerminologyValue {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.code === 'string' && o.code.trim() !== ''
    && typeof o.label === 'string' && o.label.trim() !== '';
}

/**
 * Liste de diagnostics (L21) : l'ORDRE est le rang, et le premier porte la convention
 * « diagnostic principal ». Le tableau VIDE n'en est pas une : « pas de valeur » a une seule
 * representation — la cle absente, ou un code de donnee manquante. Le serveur refuse `[]`
 * deliberement, c'est donc au client de ne jamais l'ecrire.
 */
export function isTerminologyList(v: unknown): v is TerminologyValue[] {
  return Array.isArray(v) && v.length > 0 && v.every(isTerminologyValue);
}

/** Champ acceptant PLUSIEURS diagnostics (L21). Reserve au type `terminology` cote base. */
export function isMultipleTerminology(field: { type: string; isMultiple?: boolean }): boolean {
  return field.type === 'terminology' && field.isMultiple === true;
}

/**
 * Rendu LISIBLE d'une valeur de champ, hors formulaire de saisie : listes, fiches, écrans
 * de relecture.
 *
 * Sans le cas terminologie, un diagnostic tombait dans le `String(v)` final et s'affichait
 * « [object Object] ». C'est le libellé qui est montré : le code sert au comptage, pas à la
 * lecture.
 *
 * Les codes de valeur manquante restent traités par l'appelant, qui seul dispose des
 * traductions.
 */
export function displayFieldValue(v: unknown, vide = '', field?: OptionCarrier | null): string {
  if (v === null || v === undefined || v === '') return vide;
  if (isTerminologyValue(v)) return v.label;
  // L30 : une liste controlee stocke le CODE de l'option. Sans ce passage par les
  // options, l'ecran afficherait le code, et continuerait d'afficher l'ancien texte
  // apres une correction de libelle -- la confusion meme que le lot supprime. Une valeur
  // hors liste est rendue telle quelle par `displayOptionValue`, jamais masquee.
  if (field && (field.type === 'select' || field.type === 'multiselect')) {
    return displayOptionValue(field, v) || vide;
  }
  // L21 : AVANT le cas general des tableaux. `join` appellerait `String()` sur chaque couple
  // et rendrait « [object Object] » sur toute la colonne -- exactement la regression que la
  // spec signale pour l'export. Separateur `; `, le meme que l'export.
  if (isTerminologyList(v)) return v.map((x) => x.label).join('; ');
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
export type VersionStatus = 'draft' | 'published' | 'archived';
export type RuleSeverity = 'block' | 'warn';

export interface Template {
  id: string;
  name: string;
  specialty: string | null;
  ownerUserId?: string | null;
  isGlobal?: boolean;
}

export interface TemplateVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  status: VersionStatus;
}

export interface TemplateField {
  id: string;
  fieldKey: string;
  label: string;
  description?: string | null;
  /** Valeur PROPOSEE a la creation d'une fiche. Jamais ecrite par le serveur : effacee, elle reste vide. */
  defaultValue?: string | null;
  scope: FieldScope;
  section: FieldSection;
  /**
   * Lien vers la section (L31). Nul = section inconnue ou detachee : la variable retombe
   * sur la section de secours et RESTE VISIBLE. C'est un filet, pas un detail.
   */
  sectionId?: string | null;
  /** Libelle de la section, joint a la lecture. Absent d'un instantane anterieur au lot. */
  sectionLabel?: string | null;
  /** Rang de la section voulu par le proprietaire. Absent -> ordre historique. */
  sectionOrder?: number | null;
  type: FieldType;
  /**
   * Accepte PLUSIEURS valeurs (L21) : reserve au type `terminology`. Absent d'un instantane
   * hors-ligne anterieur au lot -> unitaire, exactement le comportement d'alors.
   */
  isMultiple?: boolean;
  unit: string | null;
  /** Miroir des codes d'options (L30). Conserve pour les instantanes et clients anterieurs. */
  allowedValues: unknown[] | null;
  /**
   * Options de liste (L30) : `{value_key, label, is_active}`, source de verite. Absente
   * d'un instantane hors-ligne anterieur au lot : passer par `fieldOptions` du domaine
   * plutot que de la lire directement.
   */
  allowedOptions?: unknown[] | null;
  required: boolean;
  minValue: number | null;
  maxValue: number | null;
  allowMissingCodes: boolean;
  /**
   * Raisons de valeur manquante proposees pour CETTE variable (L33). Source de verite ;
   * `allowMissingCodes` en est le miroir. Absente d'un instantane hors-ligne anterieur au
   * lot : passer par `allowedMissingReasons` plutot que de la lire directement.
   */
  missingReasons?: MissingCode[] | null;
  displayOrder: number;
  /** Champ de rencontre limite a certains types (null/vide/absent = tous). Pilote affichage + requis. */
  encounterTypes?: string[] | null;
  /** Au moins une donnee patient/rencontre porte deja cette cle -> nom/type verrouilles. */
  inUse?: boolean;
}

/**
 * Regroupement visuel du formulaire (L31), rattache a UNE VERSION de gabarit : une section
 * suit le versionnement et le gel des versions publiees, exactement comme une variable.
 *
 * `sectionKey` est le code interne STABLE — jamais reecrit, c'est lui que portent les
 * fiches, le miroir serveur et les instantanes hors-ligne. `label` seul est corrigeable.
 */
export interface TemplateSection {
  id: string;
  sectionKey: string;
  label: string;
  displayOrder: number;
}

export interface ValidationRule {
  id: string;
  rule: unknown;
  message: string | null;
  severity: RuleSeverity;
}

export interface NewField {
  fieldKey: string;
  label: string;
  /** Consigne de saisie de la variable (jamais une donnee de dossier). */
  description?: string | null;
  /** Valeur PROPOSEE a la creation d'une fiche (`__today__` / `__now__` = resolus a la saisie). */
  defaultValue?: string | null;
  scope: FieldScope;
  section: FieldSection;
  type: FieldType;
  required: boolean;
  /** Accepte plusieurs valeurs (L21). Reserve au type `terminology` : la base refuse le reste. */
  isMultiple?: boolean;
  /** Types de rencontre concernes (vide/absent = tous). Ignore pour un champ 'patient'. */
  encounterTypes?: string[] | null;
  /** Codes autorises (select / multiselect). null/absent = libre. Miroir de `allowedOptions`. */
  allowedValues?: string[] | null;
  /** Options de liste (L30). Quand elle est fournie, c'est elle qui fait foi cote serveur. */
  allowedOptions?: FieldOption[] | null;
  /** Bornes numeriques (number / integer). */
  minValue?: number | null;
  maxValue?: number | null;
  /** Unite affichee (number / integer). */
  unit?: string | null;
  /** Autorise les codes manquants. Miroir de `missingReasons` : vrai = liste non vide. */
  allowMissingCodes?: boolean;
  /** Raisons de valeur manquante proposees pour cette variable. */
  missingReasons?: MissingCode[] | null;
}
