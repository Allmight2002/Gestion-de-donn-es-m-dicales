export type TerminologyKind = 'chapter' | 'block' | 'category';

export interface TerminologyConcept {
  id: string;
  /** Identifiant stable ; absent pour les regroupements qui n'en portent pas. */
  code: string | null;
  label: string;
  kind: TerminologyKind;
  depth: number;
  parentId: string | null;
  isSelectable: boolean;
}

export interface TerminologyParseResult {
  concepts: TerminologyConcept[];
  skipped: { noLabel: number; unknownKind: number };
}

/** Client PostgreSQL minimal attendu : seule `query` est utilisee. */
export interface TerminologyClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export interface ImportTerminologyOptions {
  slug: string;
  concepts: TerminologyConcept[];
  title?: string | null;
  source?: string | null;
  version?: string | null;
  license?: string | null;
  attribution?: string | null;
  activate?: boolean;
  replace?: boolean;
}

export function readTextFile(path: string): string;
export function parseTerminologyRows(text: string): TerminologyParseResult;
export function importTerminology(
  client: TerminologyClient,
  options: ImportTerminologyOptions,
): Promise<{ releaseId: string; inserted: number }>;
