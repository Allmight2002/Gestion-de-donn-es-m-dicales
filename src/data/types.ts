// DTO de l'admin gabarits (camelCase cote front).
// Import de TYPE uniquement : efface a la compilation, donc aucun cycle a l'execution.
import type { MissingCode } from '../domain/export';

export type FieldScope = 'patient' | 'encounter';
export type FieldSection = 'clinique' | 'biologie' | 'paraclinique';
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
export function displayFieldValue(v: unknown, vide = ''): string {
  if (v === null || v === undefined || v === '') return vide;
  if (isTerminologyValue(v)) return v.label;
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
  type: FieldType;
  unit: string | null;
  allowedValues: unknown[] | null;
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
  /** Types de rencontre concernes (vide/absent = tous). Ignore pour un champ 'patient'. */
  encounterTypes?: string[] | null;
  /** Valeurs autorisees (select / multiselect). null/absent = libre. */
  allowedValues?: string[] | null;
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
