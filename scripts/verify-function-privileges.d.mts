export interface FunctionPrivilegeRow {
  signature: string;
  config: string[] | null;
  anon_can_execute: boolean;
  authenticated_can_execute: boolean;
  service_role_can_execute: boolean;
  service_role_explicit_execute: boolean;
}

export interface SchemaPrivileges {
  anon_can_create: boolean;
  authenticated_can_create: boolean;
}

export function loadFunctionPrivilegeInventory(): {
  inventory: {
    version: number;
    schema: string;
    role: string;
    serviceRole: { rationale: string; signatures: string[] };
    categories: Array<{ id: string; rationale: string; signatures: string[] }>;
  };
  signatures: string[];
  serviceRoleSignatures: string[];
};
export function inspectFunctionPrivileges(
  rows: FunctionPrivilegeRow[],
  schemaPrivileges: SchemaPrivileges,
): string[];
export function verifyFunctionPrivileges(dbUrl: string | undefined): Promise<number>;
