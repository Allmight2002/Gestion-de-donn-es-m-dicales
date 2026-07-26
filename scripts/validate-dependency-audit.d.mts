export interface DependencyAuditValidation {
  errors: string[];
  acceptedAdvisories: string[];
  scope: string;
}

export const STAGING_AUDIT_EXCEPTION_EXPIRES_AT: string;
export const STAGING_AUDIT_ALLOWLIST: Readonly<
  Record<string, Readonly<{ packageName: string; severity: string }>>
>;

export function validateDependencyAudit(
  report: unknown,
  options?: { scope?: 'staging' | 'production'; now?: Date },
): DependencyAuditValidation;

export function assessAuditExecution(
  execution: { status?: number | null; stdout?: string; error?: unknown } | null | undefined,
  options?: { scope?: 'staging' | 'production'; now?: Date },
): DependencyAuditValidation;
