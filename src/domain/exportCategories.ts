// Export par categorie diagnostique.
//
// Les associations « diagnostic -> bloc » existent deja : ce sont les regles d'affichage
// canoniques (`diagnosticBlockRules`). Ce module les relit pour proposer, a l'export, de
// choisir une CATEGORIE plutot que des dizaines de blocs un par un. Il est pur : il ne
// produit qu'une liste de cles de blocs, que l'export envoie comme une projection
// `selected` ordinaire. Le serveur reste seul juge de la projection.

import { diagnosticBlockRules } from './diagnosisCoverage';
import { fieldOptions } from './fieldOptions';
import type { TemplateField, TemplateSection, TemplateVersion, ValidationRule } from '../data/types';

export interface ExportDiagnosisCategory {
  code: string;
  /** Libelle de l'option pour une liste ; le code lui-meme pour une terminologie. */
  label: string;
  /** Blocs RACINES associes, dans l'ordre du formulaire. */
  blockKeys: string[];
}

export function exportDiagnosisCategories(
  version: Pick<TemplateVersion, 'diagnosisContext'>,
  fields: readonly TemplateField[],
  rules: readonly Pick<ValidationRule, 'rule'>[],
  sections: readonly TemplateSection[],
): ExportDiagnosisCategory[] {
  const byKey = new Map(sections.map((s) => [s.sectionKey, s]));
  // L'export ne choisit que des blocs racines : une cible enfant remonte a son bloc.
  const rootOf = (key: string) => byKey.get(key)?.parentSectionKey || key;
  const order = (key: string) => byKey.get(key)?.displayOrder ?? Number.MAX_SAFE_INTEGER;
  const categories = new Map<string, { label: string; blocks: Set<string> }>();

  for (const config of version.diagnosisContext ?? []) {
    const driver = fields.find((f) => f.fieldKey === config.diagnosisFieldKey && f.scope === config.scope);
    const labels = new Map(fieldOptions(driver).map((o) => [o.valueKey, o.label]));
    for (const rule of diagnosticBlockRules(config, rules, fields, sections)) {
      if (!('section' in rule.then)) continue;
      const blockKey = rootOf(rule.then.section);
      const codes = Array.isArray(rule.if.value) ? rule.if.value : [rule.if.value];
      for (const code of codes) {
        if (typeof code !== 'string' || code === '') continue;
        const entry = categories.get(code) ?? { label: labels.get(code) ?? code, blocks: new Set<string>() };
        entry.blocks.add(blockKey);
        categories.set(code, entry);
      }
    }
  }

  return [...categories.entries()]
    .map(([code, { label, blocks }]) => ({
      code,
      label,
      blockKeys: [...blocks].sort((a, b) => order(a) - order(b) || a.localeCompare(b)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.code.localeCompare(b.code));
}
