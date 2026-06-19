// Couche d'acces aux donnees "gabarits" (cahier §8.2).
// Interface injectable -> l'UI ne depend pas directement de Supabase (testable).
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type {
  NewField,
  RuleSeverity,
  Template,
  TemplateField,
  TemplateVersion,
  ValidationRule,
} from './types';

export interface TemplateRepository {
  listTemplates(): Promise<(Template & { versions: TemplateVersion[] })[]>;
  createTemplate(name: string, specialty: string | null): Promise<{ template: Template; version: TemplateVersion }>;
  getVersion(versionId: string): Promise<{ version: TemplateVersion; fields: TemplateField[]; rules: ValidationRule[] }>;
  addField(versionId: string, field: NewField): Promise<TemplateField>;
  deleteField(fieldId: string): Promise<void>;
  addRule(versionId: string, rule: unknown, message: string, severity: RuleSeverity): Promise<ValidationRule>;
  deleteRule(ruleId: string): Promise<void>;
  publishVersion(versionId: string): Promise<void>;
  archiveVersion(versionId: string): Promise<void>;
  duplicateVersion(versionId: string): Promise<TemplateVersion>;
  /** Admin : promeut un gabarit (copie) en modele global propose a tous les medecins. */
  promoteToGlobal(templateId: string): Promise<void>;
}

type VersionRow = { id: string; template_id: string; version_number: number; status: TemplateVersion['status'] };
type FieldRow = {
  id: string; field_key: string; label: string; scope: TemplateField['scope']; section: TemplateField['section'];
  type: TemplateField['type']; unit: string | null; allowed_values: unknown[] | null; required: boolean;
  min_value: number | null; max_value: number | null; allow_missing_codes: boolean; display_order: number;
};
type RuleRow = { id: string; rule: unknown; message: string | null; severity: RuleSeverity };

const mapVersion = (r: VersionRow): TemplateVersion => ({
  id: r.id, templateId: r.template_id, versionNumber: r.version_number, status: r.status,
});
const mapField = (r: FieldRow): TemplateField => ({
  id: r.id, fieldKey: r.field_key, label: r.label, scope: r.scope, section: r.section, type: r.type,
  unit: r.unit, allowedValues: r.allowed_values, required: r.required, minValue: r.min_value,
  maxValue: r.max_value, allowMissingCodes: r.allow_missing_codes, displayOrder: r.display_order,
});
const mapRule = (r: RuleRow): ValidationRule => ({ id: r.id, rule: r.rule, message: r.message, severity: r.severity });

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makeTemplateRepository(client: SupabaseClient | null): TemplateRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return {
      listTemplates: fail, createTemplate: fail, getVersion: fail, addField: fail, deleteField: fail,
      addRule: fail, deleteRule: fail, publishVersion: fail, archiveVersion: fail, duplicateVersion: fail,
      promoteToGlobal: fail,
    };
  }

  return {
    async listTemplates() {
      const { data, error } = await client
        .from('template')
        .select('id, name, specialty, owner_user_id, is_global, template_version(id, template_id, version_number, status)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((t) => ({
        id: t.id as string,
        name: t.name as string,
        specialty: (t.specialty as string | null) ?? null,
        ownerUserId: (t.owner_user_id as string | null) ?? null,
        isGlobal: (t.is_global as boolean) ?? false,
        versions: ((t.template_version as VersionRow[]) ?? [])
          .map(mapVersion)
          .sort((a, b) => a.versionNumber - b.versionNumber),
      }));
    },

    async createTemplate(name, specialty) {
      // Cree par le gestionnaire de gabarits (admin) -> modele GLOBAL propose a tous.
      const { data: t, error: e1 } = await client
        .from('template')
        .insert({ name, specialty, is_global: true })
        .select('id, name, specialty')
        .single();
      if (e1) throw e1;
      const { data: v, error: e2 } = await client
        .from('template_version')
        .insert({ template_id: t.id, version_number: 1, status: 'draft' })
        .select('id, template_id, version_number, status')
        .single();
      if (e2) throw e2;
      return {
        template: { id: t.id, name: t.name, specialty: t.specialty ?? null },
        version: mapVersion(v as VersionRow),
      };
    },

    async getVersion(versionId) {
      const { data: v, error: e1 } = await client
        .from('template_version')
        .select('id, template_id, version_number, status')
        .eq('id', versionId)
        .single();
      if (e1) throw e1;
      const { data: fields, error: e2 } = await client
        .from('template_field')
        .select('*')
        .eq('template_version_id', versionId)
        .order('display_order', { ascending: true });
      if (e2) throw e2;
      const { data: rules, error: e3 } = await client
        .from('validation_rule')
        .select('id, rule, message, severity')
        .eq('template_version_id', versionId);
      if (e3) throw e3;
      return {
        version: mapVersion(v as VersionRow),
        fields: ((fields as FieldRow[]) ?? []).map(mapField),
        rules: ((rules as RuleRow[]) ?? []).map(mapRule),
      };
    },

    async addField(versionId, field) {
      const { data, error } = await client
        .from('template_field')
        .insert({
          template_version_id: versionId,
          field_key: field.fieldKey,
          label: field.label,
          scope: field.scope,
          section: field.section,
          type: field.type,
          required: field.required,
        })
        .select('*')
        .single();
      if (error) throw error;
      return mapField(data as FieldRow);
    },

    async deleteField(fieldId) {
      const { error } = await client.from('template_field').delete().eq('id', fieldId);
      if (error) throw error;
    },

    async addRule(versionId, rule, message, severity) {
      const { data, error } = await client
        .from('validation_rule')
        .insert({ template_version_id: versionId, rule, message, severity })
        .select('id, rule, message, severity')
        .single();
      if (error) throw error;
      return mapRule(data as RuleRow);
    },

    async deleteRule(ruleId) {
      const { error } = await client.from('validation_rule').delete().eq('id', ruleId);
      if (error) throw error;
    },

    async publishVersion(versionId) {
      const { error } = await client.from('template_version').update({ status: 'published' }).eq('id', versionId);
      if (error) throw error;
    },

    async archiveVersion(versionId) {
      const { error } = await client.from('template_version').update({ status: 'archived' }).eq('id', versionId);
      if (error) throw error;
    },

    async duplicateVersion(versionId) {
      const { data, error } = await client.rpc('duplicate_template_version', { p_source_version_id: versionId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as VersionRow;
      return mapVersion(row);
    },

    async promoteToGlobal(templateId) {
      const { error } = await client.rpc('promote_template_to_global', { p_template_id: templateId });
      if (error) throw error;
    },
  };
}

export const templateRepository: TemplateRepository = makeTemplateRepository(supabase);
