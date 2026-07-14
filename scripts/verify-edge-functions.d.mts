// Declarations de types pour le contrat statique des Edge Functions (verify-edge-functions.mjs),
// consommees par les tests TypeScript (test/edge-inventory.test.ts).
export const FUNCTIONS_DIR: string;
export const ENTRYPOINT: string;

export function discoverEdgeFunctions(
  root: string,
): { functions: string[]; shared: string[]; ambiguous: string[] };

export function declaredFunctions(configTomlText: string): string[];

export function checkEntrypointContent(name: string, content: string): string[];

export function verifyEdgeFunctions(
  root: string,
): { ok: boolean; errors: string[]; functions: string[] };
