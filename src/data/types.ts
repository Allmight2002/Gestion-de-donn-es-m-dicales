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
}
