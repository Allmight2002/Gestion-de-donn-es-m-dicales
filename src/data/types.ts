// DTO de l'admin gabarits (camelCase cote front).
export type FieldScope = 'patient' | 'encounter';
export type FieldSection = 'clinique' | 'biologie' | 'paraclinique';
export type FieldType =
  | 'number' | 'integer' | 'text' | 'date' | 'datetime' | 'boolean' | 'select' | 'multiselect';
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
  scope: FieldScope;
  section: FieldSection;
  type: FieldType;
  unit: string | null;
  allowedValues: unknown[] | null;
  required: boolean;
  minValue: number | null;
  maxValue: number | null;
  allowMissingCodes: boolean;
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
  /** Autorise les codes manquants (non_fait / inconnu / non_applicable). */
  allowMissingCodes?: boolean;
}
