export function validateOperationsEvidence(
  evidence: Record<string, unknown>,
  options?: { expectedCommit?: string; now?: Date },
): string[];
