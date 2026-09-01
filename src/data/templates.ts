// Couche d'acces aux donnees "gabarits" (cahier §8.2).
// Interface injectable -> l'UI ne depend pas directement de Supabase (testable).
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { MissingCode } from '../domain/export';
import { optionKeys, toRawOptions } from '../domain/fieldOptions';
import type {
  NewField,
  RuleSeverity,
  Template,
  TemplateField,
  TemplateSection,
  TemplateVersion,
  ValidationRule,
} from './types';

export interface TemplateRepository {
  listTemplates(): Promise<(Template & { versions: TemplateVersion[] })[]>;
  createTemplate(name: string, specialty: string | null): Promise<{ template: Template; version: TemplateVersion }>;
  /** Medecin : cree un gabarit PERSONNEL vierge (brouillon v1) qu'il pourra remplir puis utiliser
   *  pour une base. Renvoie la version a editer. (RLS : owner = soi, is_global = false.) */
  createPersonalTemplate(name: string, specialty: string | null): Promise<TemplateVersion>;
  /** Commande atomique de creation/clonage. Les champs et la base optionnelle sont persistés ensemble. */
  createTemplateBundle(input: TemplateBundleInput): Promise<TemplateBundleResult>;
  getVersion(versionId: string): Promise<{ version: TemplateVersion; fields: TemplateField[]; rules: ValidationRule[]; sections: TemplateSection[] }>;
  /** Lecture legere pour les ecrans qui n'ont besoin que d'afficher des champs. */
  getFields?(versionId: string): Promise<TemplateField[]>;
  /** Sections de la version (L31). Lecture seule, dans l'ordre voulu par le proprietaire. */
  getSections?(versionId: string): Promise<TemplateSection[]>;
  /** Cree une section. Refusee sur une version publiee (garde serveur). */
  addSection?(versionId: string, sectionKey: string, label: string): Promise<TemplateSection>;
  /** Corrige le LIBELLE d'une section. Son code interne, lui, ne se modifie jamais (L31). */
  renameSection?(sectionId: string, label: string): Promise<void>;
  /** Supprime une section. Refusee si elle porte encore une variable (garde serveur). */
  deleteSection?(sectionId: string): Promise<void>;
  /** Reordonne les sections d'une version : `orderedIds` dans le nouvel ordre. */
  reorderSections?(versionId: string, orderedIds: string[]): Promise<void>;
  /** Ajoute un champ et, le cas echeant, son compagnon dans la meme requete atomique. */
  addField(versionId: string, field: NewField, companion?: NewField): Promise<TemplateField>;
  /** Modifie un champ. Le nom interne / type ne changent que si la variable n'a aucune donnee (garde cote base). */
  updateField(fieldId: string, field: NewField): Promise<TemplateField>;
  deleteField(fieldId: string): Promise<void>;
  /** Reordonne les variables d'une version (drag & drop) : `orderedIds` dans le nouvel ordre. */
  reorderFields(versionId: string, orderedIds: string[]): Promise<void>;
  addRule(versionId: string, rule: unknown, message: string, severity: RuleSeverity): Promise<ValidationRule>;
  updateRule(ruleId: string, rule: unknown, message: string, severity: RuleSeverity): Promise<ValidationRule>;
  deleteRule(ruleId: string): Promise<void>;
  publishVersion(versionId: string): Promise<void>;
  archiveVersion(versionId: string): Promise<void>;
  duplicateVersion(versionId: string): Promise<TemplateVersion>;
  /** Medecin : cree la version SUIVANTE de SON gabarit personnel (copie editable en draft).
   *  Permet de faire evoluer une variable/regle deja utilisee sans toucher l'historique (§8.2). */
  createNextVersion(templateId: string): Promise<TemplateVersion>;
  /** Admin : promeut un gabarit (copie) en modele global propose a tous les medecins. */
  promoteToGlobal(templateId: string): Promise<void>;
  /** Renomme un gabarit (nom + specialite). Reserve au proprietaire / admin (RLS). */
  renameTemplate(templateId: string, name: string, specialty: string | null): Promise<void>;
  /** Supprime un gabarit (cascade versions). Refuse s'il est utilise par une base / des donnees. */
  deleteTemplate(templateId: string): Promise<void>;
}

export interface TemplateBundleInput {
  name: string;
  specialty: string | null;
  fields?: NewField[];
  sourceVersionId?: string;
  withBase?: boolean;
  baseName?: string;
  isGlobal?: boolean;
  operationKey: string;
}
export interface TemplateBundleResult { templateId: string; versionId: string; baseId: string | null; }

type VersionRow = {
  id: string;
  template_id: string;
  version_number: number;
  status: TemplateVersion['status'];
  template_field?: { id: string }[];
};
type FieldRow = {
  id: string; field_key: string; label: string; scope: TemplateField['scope']; section: TemplateField['section'];
  description: string | null;
  default_value: string | null;
  type: TemplateField['type']; is_multiple: boolean | null;
  unit: string | null; allowed_values: unknown[] | null;
  allowed_options: unknown[] | null; required: boolean;
  min_value: number | null; max_value: number | null; allow_missing_codes: boolean;
  missing_reasons: MissingCode[] | null;
  /** Variable calculee (L35). Absente d'une reponse anterieure au lot -> variable saisie. */
  formula?: string | null;
  display_order: number;
  encounter_types: string[] | null;
};
type RuleRow = { id: string; rule: unknown; message: string | null; severity: RuleSeverity };
type SectionRow = { id: string; section_key: string; label: string; display_order: number };

const mapVersion = (r: VersionRow): TemplateVersion => ({
  id: r.id,
  templateId: r.template_id,
  versionNumber: r.version_number,
  status: r.status,
  fieldCount: Array.isArray(r.template_field) ? r.template_field.length : undefined,
});
const mapSection = (r: SectionRow): TemplateSection => ({
  id: r.id, sectionKey: r.section_key, label: r.label, displayOrder: r.display_order,
});

const SECTION_COLUMNS = 'id, section_key, label, display_order';

/**
 * Attache a chaque variable le libelle et le rang de SA section (L31), pour que les ecrans
 * de saisie n'aient pas a charger les sections separement.
 *
 * Une variable dont la section n'est pas dans la liste ressort telle quelle : elle garde
 * son code et retombe sur le filet a l'affichage, au lieu de disparaitre.
 */
const withSections = (fields: TemplateField[], sections: TemplateSection[]): TemplateField[] => {
  if (sections.length === 0) return fields;
  const bySectionKey = new Map(sections.map((s) => [s.sectionKey, s]));
  return fields.map((field) => {
    const section = bySectionKey.get(field.section);
    return section
      ? { ...field, sectionId: section.id, sectionLabel: section.label, sectionOrder: section.displayOrder }
      : field;
  });
};
const mapField = (r: FieldRow): TemplateField => ({
  id: r.id, fieldKey: r.field_key, label: r.label, description: r.description, defaultValue: r.default_value,
  scope: r.scope, section: r.section, type: r.type, isMultiple: r.is_multiple ?? false,
  unit: r.unit, allowedValues: r.allowed_values, allowedOptions: r.allowed_options,
  required: r.required, minValue: r.min_value,
  maxValue: r.max_value, allowMissingCodes: r.allow_missing_codes, missingReasons: r.missing_reasons,
  formula: r.formula ?? null,
  displayOrder: r.display_order,
  encounterTypes: r.encounter_types,
});
const mapRule = (r: RuleRow): ValidationRule => ({ id: r.id, rule: r.rule, message: r.message, severity: r.severity });

const NOT_CONFIGURED = 'Backend Supabase non configure';

export async function getTemplateFields(repo: TemplateRepository, versionId: string): Promise<TemplateField[]> {
  return repo.getFields ? repo.getFields(versionId) : (await repo.getVersion(versionId)).fields;
}

export function makeTemplateRepository(client: SupabaseClient | null): TemplateRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return {
      listTemplates: fail, createTemplate: fail, createPersonalTemplate: fail, createTemplateBundle: fail, getVersion: fail, addField: fail, updateField: fail,
      getSections: fail, addSection: fail, renameSection: fail, deleteSection: fail, reorderSections: fail,
      deleteField: fail, reorderFields: fail, addRule: fail, updateRule: fail, deleteRule: fail, publishVersion: fail,
      archiveVersion: fail, duplicateVersion: fail, createNextVersion: fail, promoteToGlobal: fail, renameTemplate: fail,
      deleteTemplate: fail,
    };
  }

  // Cache de SESSION des versions (gabarits quasi-immuables) : evite de recharger fields+rules a
  // chaque ecran. Vide des qu'une ecriture de gabarit a lieu (clearVersionCache dans les writes).
  const versionCache = new Map<string, { version: TemplateVersion; fields: TemplateField[]; rules: ValidationRule[]; sections: TemplateSection[] }>();
  const fieldsCache = new Map<string, TemplateField[]>();
  const clearVersionCache = () => { versionCache.clear(); fieldsCache.clear(); };

  return {
    async createTemplateBundle(input) {
      const { data, error } = await client.rpc('create_template_bundle', {
        p_payload: {
          name: input.name,
          specialty: input.specialty,
          fields: input.fields ?? [],
          sourceVersionId: input.sourceVersionId ?? null,
          withBase: input.withBase ?? false,
          baseName: input.baseName ?? null,
          isGlobal: input.isGlobal ?? false,
        },
        p_operation_key: input.operationKey,
      });
      if (error) throw error;
      clearVersionCache();
      const row = (Array.isArray(data) ? data[0] : data) as { templateId: string; versionId: string; baseId?: string | null };
      return { templateId: row.templateId, versionId: row.versionId, baseId: row.baseId ?? null };
    },

    async listTemplates() {
      const { data, error } = await client
        .from('template')
        .select('id, name, specialty, owner_user_id, is_global, template_version(id, template_id, version_number, status, template_field(id))')
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
      const result = await this.createTemplateBundle({ name, specialty, isGlobal: true, operationKey: crypto.randomUUID() });
      return {
        template: { id: result.templateId, name, specialty },
        version: { id: result.versionId, templateId: result.templateId, versionNumber: 1, status: 'draft' },
      };
    },

    async createPersonalTemplate(name, specialty) {
      const result = await this.createTemplateBundle({ name, specialty, operationKey: crypto.randomUUID() });
      return { id: result.versionId, templateId: result.templateId, versionNumber: 1, status: 'draft' };
    },

    async getVersion(versionId) {
      const cached = versionCache.get(versionId);
      if (cached) return cached;
      // Les 5 lectures sont INDEPENDANTES -> en parallele (1 aller-retour au lieu de 5).
      const [vRes, fRes, rRes, uRes, sRes] = await Promise.all([
        client.from('template_version').select('id, template_id, version_number, status').eq('id', versionId).single(),
        client.from('template_field').select('*').eq('template_version_id', versionId).order('display_order', { ascending: true }),
        client.from('validation_rule').select('id, rule, message, severity').eq('template_version_id', versionId),
        client.rpc('template_version_fields_in_use', { p_version_id: versionId }),
        client.from('template_section').select(SECTION_COLUMNS).eq('template_version_id', versionId).order('display_order', { ascending: true }),
      ]);
      if (vRes.error) throw vRes.error;
      if (fRes.error) throw fRes.error;
      if (rRes.error) throw rRes.error;
      if (uRes.error) throw uRes.error;
      if (sRes.error) throw sRes.error;
      const used = new Set(
        ((uRes.data ?? []) as (string | { id?: string })[]).map((x) => (typeof x === 'string' ? x : x.id ?? '')),
      );
      const sections = ((sRes.data as SectionRow[]) ?? []).map(mapSection);
      const result = {
        version: mapVersion(vRes.data as VersionRow),
        fields: withSections(
          ((fRes.data as FieldRow[]) ?? []).map((r) => ({ ...mapField(r), inUse: used.has(r.id) })),
          sections,
        ),
        rules: ((rRes.data as RuleRow[]) ?? []).map(mapRule),
        sections,
      };
      versionCache.set(versionId, result);
      fieldsCache.set(versionId, result.fields);
      return result;
    },

    async getFields(versionId) {
      const cachedVersion = versionCache.get(versionId);
      if (cachedVersion) return cachedVersion.fields;
      const cachedFields = fieldsCache.get(versionId);
      if (cachedFields) return cachedFields;
      const [fRes, sRes] = await Promise.all([
        client
          .from('template_field')
          .select('id, field_key, label, description, default_value, scope, section, type, unit, allowed_values, allowed_options, required, min_value, max_value, allow_missing_codes, missing_reasons, formula, display_order, encounter_types')
          .eq('template_version_id', versionId)
          .order('display_order', { ascending: true }),
        client.from('template_section').select(SECTION_COLUMNS).eq('template_version_id', versionId).order('display_order', { ascending: true }),
      ]);
      if (fRes.error) throw fRes.error;
      if (sRes.error) throw sRes.error;
      const fields = withSections(
        ((fRes.data as FieldRow[]) ?? []).map(mapField),
        ((sRes.data as SectionRow[]) ?? []).map(mapSection),
      );
      fieldsCache.set(versionId, fields);
      return fields;
    },

    async getSections(versionId) {
      const { data, error } = await client
        .from('template_section')
        .select(SECTION_COLUMNS)
        .eq('template_version_id', versionId)
        .order('display_order', { ascending: true });
      if (error) throw error;
      return ((data as SectionRow[]) ?? []).map(mapSection);
    },

    async addSection(versionId, sectionKey, label) {
      // Nouvelles sections EN FIN de liste, comme les variables.
      const { data: last } = await client
        .from('template_section')
        .select('display_order')
        .eq('template_version_id', versionId)
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data, error } = await client
        .from('template_section')
        .insert({
          template_version_id: versionId,
          section_key: sectionKey,
          label,
          display_order: ((last?.display_order as number | undefined) ?? -1) + 1,
        })
        .select(SECTION_COLUMNS)
        .single();
      if (error) throw error;
      clearVersionCache();
      return mapSection(data as SectionRow);
    },

    async renameSection(sectionId, label) {
      // SEUL le libelle part : le code interne est la reference stable des variables et
      // des instantanes hors-ligne, et le declencheur serveur refuse de le voir changer.
      const { error } = await client.from('template_section').update({ label }).eq('id', sectionId);
      if (error) throw error;
      clearVersionCache();
    },

    async deleteSection(sectionId) {
      const { error } = await client.from('template_section').delete().eq('id', sectionId);
      if (error) throw error;
      clearVersionCache();
    },

    async reorderSections(versionId, orderedIds) {
      const { error } = await client.rpc('reorder_template_sections', {
        p_version_id: versionId,
        p_section_ids: orderedIds,
      });
      if (error) throw error;
      clearVersionCache();
    },

    async addField(versionId, field, companion) {
      // Nouvelles variables EN FIN de liste. Le tableau est insere par une seule requete
      // PostgREST : le champ source et son compagnon reussissent ou echouent ensemble.
      const { data: last } = await client
        .from('template_field')
        .select('display_order')
        .eq('template_version_id', versionId)
        .order('display_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextOrder = ((last?.display_order as number | undefined) ?? -1) + 1;
      const fields = companion ? [field, companion] : [field];
      const { data, error } = await client
        .from('template_field')
        .insert(fields.map((item, index) => ({
          template_version_id: versionId,
          field_key: item.fieldKey,
          label: item.label,
          description: item.description?.trim() || null,
          default_value: item.defaultValue?.trim() || null,
          scope: item.scope,
          section: item.section,
          type: item.type,
          // L21 : la cardinalite n'est LEGITIME que sur un diagnostic. Le champ compagnon
          // « valeur proposee » est de type texte : il repart donc toujours a faux, comme la
          // contrainte serveur `template_field_multiple_terminology_only` l'exige.
          is_multiple: item.type === 'terminology' && item.isMultiple === true,
          required: item.required,
          display_order: nextOrder + index,
          encounter_types: item.scope === 'encounter' ? item.encounterTypes ?? null : null,
          // Les deux partent ENSEMBLE et coherents : les options font foi, le miroir des
          // cles evite qu'un client non rafraichi ne lise une colonne vide.
          allowed_values: item.allowedOptions
            ? optionKeys(item.allowedOptions)
            : item.allowedValues ?? null,
          allowed_options: item.allowedOptions ? toRawOptions(item.allowedOptions) : null,
          min_value: item.minValue ?? null,
          max_value: item.maxValue ?? null,
          unit: item.unit ?? null,
          // Les deux sont envoyes ENSEMBLE et coherents : le declencheur serveur n'a alors
          // rien a arbitrer. Un client ancien, lui, n'enverra que le booleen.
          allow_missing_codes: (item.missingReasons ?? []).length > 0,
          missing_reasons: item.missingReasons ?? [],
          // L35 : le serveur VALIDE la formule et en DEDUIT le type de sortie. Une variable
          // saisie envoie null et retrouve exactement le comportement d'avant le lot.
          formula: item.formula?.trim() || null,
        })))
        .select('*');
      if (error) throw error;
      const inserted = ((data as FieldRow[]) ?? []).find((row) => row.field_key === field.fieldKey);
      if (!inserted) throw new Error('La variable creee est absente de la reponse serveur.');
      clearVersionCache();
      return mapField(inserted);
    },

    async updateField(fieldId, field) {
      const { data, error } = await client.rpc('update_template_field', {
        p_field_id: fieldId,
        p_field_key: field.fieldKey,
        p_label: field.label,
        p_description: field.description?.trim() || null,
        p_default_value: field.defaultValue?.trim() || null,
        p_scope: field.scope,
        p_section: field.section,
        p_type: field.type,
        p_required: field.required,
        // `p_is_multiple` selectionne la surcharge L21 de la RPC. Sans cette cle, PostgREST
        // resout la signature anterieure et la cardinalite ne serait jamais ecrite.
        p_is_multiple: field.type === 'terminology' && field.isMultiple === true,
        p_encounter_types: field.scope === 'encounter' ? field.encounterTypes ?? null : null,
        // `p_allowed_options` selectionne la surcharge L30 de la RPC ; le serveur en deduit
        // lui-meme le miroir `allowed_values`.
        p_allowed_options: field.allowedOptions ? toRawOptions(field.allowedOptions) : null,
        p_allowed_values: field.allowedValues ?? null,
        p_min_value: field.minValue ?? null,
        p_max_value: field.maxValue ?? null,
        p_unit: field.unit ?? null,
        p_missing_reasons: field.missingReasons ?? [],
        // `p_formula` selectionne la surcharge L35 de la RPC. Sans cette cle, PostgREST
        // resout la signature anterieure et la variable reste saisie.
        p_formula: field.formula?.trim() || null,
      });
      if (error) throw error;
      clearVersionCache();
      const row = (Array.isArray(data) ? data[0] : data) as FieldRow;
      return mapField(row);
    },

    async deleteField(fieldId) {
      // Passe par la RPC : refuse la suppression d'une variable deja utilisee (garde serveur).
      const { error } = await client.rpc('delete_template_field', { p_field_id: fieldId });
      if (error) throw error;
      clearVersionCache();
    },

    async reorderFields(versionId, orderedIds) {
      const { error } = await client.rpc('reorder_template_fields', {
        p_version_id: versionId,
        p_field_ids: orderedIds,
      });
      if (error) throw error;
      clearVersionCache();
    },

    async addRule(versionId, rule, message, severity) {
      const { data, error } = await client
        .from('validation_rule')
        .insert({ template_version_id: versionId, rule, message, severity })
        .select('id, rule, message, severity')
        .single();
      if (error) throw error;
      clearVersionCache();
      return mapRule(data as RuleRow);
    },

    async updateRule(ruleId, rule, message, severity) {
      const { data, error } = await client
        .from('validation_rule')
        .update({ rule, message, severity })
        .eq('id', ruleId)
        .select('id, rule, message, severity')
        .single();
      if (error) throw error;
      clearVersionCache();
      return mapRule(data as RuleRow);
    },

    async deleteRule(ruleId) {
      const { error } = await client.from('validation_rule').delete().eq('id', ruleId);
      if (error) throw error;
      clearVersionCache();
    },

    async publishVersion(versionId) {
      const { error } = await client.rpc('publish_template_version', { p_version_id: versionId });
      if (error) throw error;
      clearVersionCache();
    },

    async archiveVersion(versionId) {
      const { error } = await client.rpc('archive_template_version', { p_version_id: versionId });
      if (error) throw error;
      clearVersionCache();
    },

    async duplicateVersion(versionId) {
      const { data, error } = await client.rpc('duplicate_template_version', { p_source_version_id: versionId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as VersionRow;
      return mapVersion(row);
    },

    async createNextVersion(templateId) {
      const { data, error } = await client.rpc('create_next_personal_template_version', { p_template_id: templateId });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as VersionRow;
      return mapVersion(row);
    },

    async promoteToGlobal(templateId) {
      const { error } = await client.rpc('promote_template_to_global', { p_template_id: templateId });
      if (error) throw error;
    },

    async renameTemplate(templateId, name, specialty) {
      const { error } = await client.from('template').update({ name, specialty }).eq('id', templateId);
      if (error) throw error;
    },

    async deleteTemplate(templateId) {
      const { error } = await client.rpc('delete_template', { p_template_id: templateId });
      if (error) throw error;
    },
  };
}

export const templateRepository: TemplateRepository = makeTemplateRepository(supabase);
