export const STAGING_PROJECT_REF: string;
export const PRODUCTION_PROJECT_REF: string;

export type SupabaseTargetEnvironment = Partial<
  Record<
    'SUPABASE_PROJECT_REF' | 'VITE_SUPABASE_URL' | 'SUPABASE_URL' | 'SUPABASE_DB_URL',
    string | undefined
  >
>;

export function projectRefFromSupabaseUrl(value: string | undefined): string | null;
export function projectRefFromDatabaseUrl(value: string | undefined): string | null;

export function validateSupabaseTarget(options: {
  target: 'staging' | 'production';
  env?: SupabaseTargetEnvironment;
  frontendOnly?: boolean;
}): string[];
