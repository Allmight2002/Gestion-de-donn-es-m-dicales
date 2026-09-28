// Fichier de definition d'un jeu de variables (export_template_definition /
// import_template_definition). Il ne porte que la STRUCTURE : aucune donnee patient, aucun
// identifiant interne. Le serveur revalide tout a l'import ; la lecture ci-dessous ne sert
// qu'a refuser tot un fichier qui n'est manifestement pas une definition MedData.

export const TEMPLATE_DEFINITION_FORMAT = 'meddata.template-definition';
export const TEMPLATE_DEFINITION_VERSION = 1;
/** Un gabarit plafonne a 500 variables : 5 Mo couvre largement un fichier legitime. */
export const TEMPLATE_DEFINITION_MAX_BYTES = 5 * 1024 * 1024;

export interface TemplateDefinition {
  format: typeof TEMPLATE_DEFINITION_FORMAT;
  formatVersion: number;
  exportedAt?: string;
  template: { name: string | null; specialty: string | null; versionNumber?: number; status?: string };
  sections: unknown[];
  commonGroups: unknown[];
  fields: unknown[];
  rules: unknown[];
  diagnosisConfiguration: unknown[];
  terminologyReleases: unknown[];
}

export type TemplateDefinitionParse =
  | { ok: true; definition: TemplateDefinition }
  | { ok: false; error: 'too_large' | 'not_json' | 'not_definition' | 'unsupported_version' };

const ARRAYS = ['sections', 'commonGroups', 'fields', 'rules', 'diagnosisConfiguration', 'terminologyReleases'] as const;

export function parseTemplateDefinition(text: string): TemplateDefinitionParse {
  if (text.length > TEMPLATE_DEFINITION_MAX_BYTES) return { ok: false, error: 'too_large' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'not_definition' };
  const candidate = value as Record<string, unknown>;
  if (candidate.format !== TEMPLATE_DEFINITION_FORMAT) return { ok: false, error: 'not_definition' };
  if (candidate.formatVersion !== TEMPLATE_DEFINITION_VERSION) return { ok: false, error: 'unsupported_version' };
  const template = candidate.template;
  if (!template || typeof template !== 'object' || Array.isArray(template)) return { ok: false, error: 'not_definition' };
  for (const key of ARRAYS) {
    if (candidate[key] !== undefined && !Array.isArray(candidate[key])) return { ok: false, error: 'not_definition' };
  }
  return { ok: true, definition: candidate as unknown as TemplateDefinition };
}

/** Nom de fichier lisible et sur pour tous les systemes : `jeu-<nom>-v<n>.meddata.json`. */
export function templateDefinitionFileName(name: string, versionNumber?: number): string {
  const slug = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'jeu-de-variables';
  return `jeu-${slug}${versionNumber ? `-v${versionNumber}` : ''}.meddata.json`;
}

export function downloadTemplateDefinition(definition: TemplateDefinition, fileName: string): void {
  const blob = new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
