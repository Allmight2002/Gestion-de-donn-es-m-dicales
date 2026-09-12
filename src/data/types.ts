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
export type FieldSection = string | null;
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
  /** Nombre de variables connu par les lectures de liste ; absent des lectures de détail. */
  fieldCount?: number;
  /** L55 : absence = collecte historique. La version du dossier reste la source. */
  diagnosisConfiguration?: DiagnosisConfiguration[];
  diagnosisContext?: DiagnosisContext[];
  /**
   * UX-16 : organisation de PRESENTATION des variables communes. Absente quand la
   * migration n'est pas encore disponible pour la lecture : les ecrans conservent alors
   * le rendu historique « Tronc commun » plutot que de masquer des variables.
   */
  commonLayout?: TemplateCommonLayout;
}

/** Une rubrique commune, sans condition ni appartenance clinique. */
export interface TemplateCommonGroup {
  key: string;
  label: string;
  /** Nombre de blocs racines places avant cette rubrique. */
  anchor: number;
  isDefault: boolean;
  /** Cles des variables communes, dans leur ordre de presentation. */
  fields: string[];
}

/** Etat versionne lu et accuse par les RPC UX-16. */
export interface TemplateCommonLayout {
  fingerprint: string;
  locked: boolean;
  inUse: boolean;
  defaultKey: string | null;
  /** Blocs racines servant de reperes aux ancres, sans en faire des rubriques. */
  sections: { key: string; label: string }[];
  groups: TemplateCommonGroup[];
  /** Filet de lecture : ces variables restent rendues, jamais omises. */
  unassigned: string[];
}

/** Charge COMPLETE de l'operation atomique `set_common_layout`. */
export interface CommonLayoutPayload {
  defaultKey?: string | null;
  groups: Array<Pick<TemplateCommonGroup, 'key' | 'label' | 'anchor' | 'fields'>>;
}

export interface DiagnosisConfiguration {
  scope: FieldScope;
  diagnosisFieldKey: string;
  terminologyReleaseId: string | null;
  commonOnlyCodes: string[];
}

export interface DiagnosisContext extends DiagnosisConfiguration {
  proposalFieldKey: string;
  recognizedCodes: string[];
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
  parentSectionKey?: string | null;
  parentSectionLabel?: string | null;
  type: FieldType;
  /**
   * Accepte PLUSIEURS valeurs (L21) : reserve au type `terminology`. Absent d'un instantane
   * hors-ligne anterieur au lot -> unitaire, exactement le comportement d'alors.
   */
  isMultiple?: boolean;
  /** Unite affichee, ou unite de restitution d'une formule temporelle. */
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
  /**
   * Variable CALCULEE (L35) : `date_sortie - date_entree`, forme canonique « A op B ».
   * Null/absent = variable saisie, comme avant le lot. Le resultat n'est JAMAIS stocke :
   * il est recalcule a l'affichage et a l'export par `evaluateFormula` (domain/export).
   */
  formula?: string | null;
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
  parentSectionKey?: string | null;
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
  /** Unite affichee (number / integer), ou unite de restitution d'une formule temporelle. */
  unit?: string | null;
  /** Autorise les codes manquants. Miroir de `missingReasons` : vrai = liste non vide. */
  allowMissingCodes?: boolean;
  /** Raisons de valeur manquante proposees pour cette variable. */
  missingReasons?: MissingCode[] | null;
  /** Calcul defini par l'utilisateur (L35), forme canonique « A op B ». Null = variable saisie. */
  formula?: string | null;
}

// --- L59 : import d'un bloc reutilisable ---------------------------------------------------

/** Un bloc racine proposé au catalogue d'import, tel que le serveur le rend lisible. */
export interface ImportableBlock {
  templateId: string;
  /** Nul quand la RLS du gabarit masque son nom alors que la version reste lisible
   *  (lecture par base partagée) : l'écran retombe alors sur le numéro de version. */
  templateName: string | null;
  isGlobal: boolean;
  versionId: string;
  versionNumber: number;
  versionStatus: VersionStatus;
  sectionKey: string;
  label: string;
  displayOrder: number;
  subsectionCount: number;
  /** Variables portées par le bloc, sous-sections comprises. */
  fieldCount: number;
}

/** Les douze refus typés de L58 (§4.4 de spec-blocs-reutilisables.md). */
export type SectionImportRefusalCode =
  | 'IMPORT_SOURCE_FORBIDDEN'
  | 'IMPORT_TARGET_FORBIDDEN'
  | 'IMPORT_SOURCE_NOT_A_BLOCK'
  | 'IMPORT_TARGET_LOCKED'
  | 'IMPORT_TARGET_IN_USE'
  | 'IMPORT_SECTION_EXISTS'
  | 'IMPORT_FIELD_CONFLICT'
  | 'IMPORT_REUSE_INCOMPATIBLE'
  | 'IMPORT_REUSE_IN_BLOCK'
  | 'IMPORT_FORMULA_OPERAND_MISSING'
  | 'IMPORT_FORMULA_OPERAND_INCOMPATIBLE'
  | 'IMPORT_VISIBILITY_CYCLE';

export interface SectionImportConflict {
  code: SectionImportRefusalCode;
  fieldKey: string | null;
  /** Section de la version CIBLE où vit la variable en conflit ; null = tronc commun. */
  existingSection: string | null;
  /** Vrai seulement quand le SERVEUR a jugé la réutilisation possible. L'écran ne
   *  propose jamais de réutiliser une variable qu'il aurait jugée compatible lui-même. */
  reusable: boolean;
  /** Opérande fautif d'une formule, le cas échéant. */
  operandKey?: string | null;
}

/** Rapport rendu à l'identique par la prévisualisation et par l'import (§4.1). */
export interface SectionImportReport {
  sectionKey: string;
  subsections: string[];
  importedFields: string[];
  reusedFields: string[];
  copiedRules: number;
  /** Règle d'activation du bloc dans la SOURCE, jamais copiée (D7). Matière de L60. */
  activationRule: { field?: string; operator?: string; value?: unknown; terminologyReleaseId?: string | null } | null;
  conflicts: SectionImportConflict[];
}

/**
 * UX-14(c) — lot de règles construit à partir d'UNE condition et de plusieurs cibles.
 * Le serveur fabrique lui-même les règles unitaires : aucune règle multicible n'existe en base,
 * et la charge ne transporte donc pas de JSON de règle déjà assemblé par l'écran.
 */
export interface RuleBatchPayload {
  condition: Record<string, unknown>;
  effect: 'required' | 'visible';
  targets: string[];
  message?: string | null;
  severity?: RuleSeverity;
}

/** Plan rendu par l'aperçu : ce qui serait créé, ce qui existe déjà, ce qui est refusé. */
export interface RuleBatchPlan {
  /** Empreinte de la version à présenter à la confirmation ; périmée = conflit, pas d'écriture. */
  fingerprint: string;
  severity: RuleSeverity;
  create: { target: string }[];
  duplicates: { target: string; ruleId: string }[];
  invalid: { target: string; reason: string }[];
  locked: boolean;
  inUse: boolean;
}

/** Reçu d'un lot appliqué. Rejouer la même opération rend exactement ce même reçu. */
export interface RuleBatchReceipt {
  created: { id: string; target: string }[];
  duplicates: { target: string; ruleId: string }[];
  fingerprint: string;
}
