export interface DependencyAuditValidation {
  errors: string[];
  acceptedAdvisories: string[];
  scope: string;
}

export function validateDependencyAudit(
  report: unknown,
  options?: { scope?: 'staging' | 'production' },
): DependencyAuditValidation;

export function assessAuditExecution(
  execution: { status?: number | null; stdout?: string; error?: unknown } | null | undefined,
  options?: { scope?: 'staging' | 'production' },
): DependencyAuditValidation;
