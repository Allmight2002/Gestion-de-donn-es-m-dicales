import type { DiagnosisContext, FieldScope, TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../data/types';
import { isTerminologyValue, isTerminologyList } from '../data/types';
import { applyOp } from './validation';
import { visibilityRulesOf, visibilityTargetFieldKeys } from './templateRules';

export type DiagnosisCoverageStatus = 'covered' | 'common_only' | 'uncovered' | 'unclassified';
export interface DiagnosisCoverageItem {
  code: string | null;
  status: DiagnosisCoverageStatus;
  blockKeys: string[];
}
export interface DiagnosisCoverage {
  versionId: string;
  scope: FieldScope;
  diagnostics: DiagnosisCoverageItem[];
  counts: Record<DiagnosisCoverageStatus, number>;
}

/** Aucun libellé ni texte de proposition dans le résultat dérivé. */
export function calculateDiagnosisCoverage(
  version: Pick<TemplateVersion, 'id' | 'diagnosisContext'>,
  scope: FieldScope,
  values: Record<string, unknown>,
  fields: readonly TemplateField[],
  rules: readonly Pick<ValidationRule, 'rule'>[],
  sections: readonly TemplateSection[] = [],
): DiagnosisCoverage {
  const result: DiagnosisCoverage = { versionId: version.id, scope, diagnostics: [],
    counts: { covered: 0, common_only: 0, uncovered: 0, unclassified: 0 } };
  const config = version.diagnosisContext?.find((c) => c.scope === scope);
  if (!config) return result;
  const field = fields.find((f) => f.fieldKey === config.diagnosisFieldKey && f.scope === scope);
  if (!field) throw new Error('DIAGNOSIS_CONTEXT_INVALID');
  const value = values[field.fieldKey];
  let codes: string[] = [];
  if (field.type === 'terminology') {
    codes = field.isMultiple
      ? (isTerminologyList(value) ? value.map((v) => v.code) : [])
      : (isTerminologyValue(value) ? [value.code] : []);
  } else if (field.type === 'multiselect') {
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) codes = value;
  } else if (typeof value === 'string') codes = [value];
  if (!applyOp('contains_any', value, config.recognizedCodes)) codes = [];
  const associations = diagnosticBlockRules(config, rules, fields, sections);
  for (const code of new Set(codes)) {
    // Une valeur hors référentiel n'est jamais convertie en faux diagnostic.
    if (!config.recognizedCodes.includes(code)) continue;
    const blockKeys = [...new Set(associations.filter((r) => (r.if.value as string[]).includes(code))
      .map((r) => 'section' in r.then ? r.then.section : ''))].sort();
    const status = blockKeys.length ? 'covered' : config.commonOnlyCodes.includes(code) ? 'common_only' : 'uncovered';
    result.diagnostics.push({ code, status, blockKeys });
    result.counts[status]++;
  }
  const proposal = values[config.proposalFieldKey];
  if (typeof proposal === 'string' && proposal.trim()) {
    result.diagnostics.push({ code: null, status: 'unclassified', blockKeys: [] });
    result.counts.unclassified++;
  }
  return result;
}

export function diagnosticBlockRules(config: DiagnosisContext, rules: readonly Pick<ValidationRule, 'rule'>[],
  fields: readonly TemplateField[], sections: readonly TemplateSection[]) {
  return visibilityRulesOf(rules.map((r) => r.rule)).filter((r) =>
    'section' in r.then && r.if.field === config.diagnosisFieldKey && r.if.operator === 'contains_any'
    && (r.if.terminologyReleaseId ?? null) === config.terminologyReleaseId
    && visibilityTargetFieldKeys(r, fields, sections).some((key) =>
      fields.some((f) => f.fieldKey === key && f.scope === config.scope && !f.formula)));
}
