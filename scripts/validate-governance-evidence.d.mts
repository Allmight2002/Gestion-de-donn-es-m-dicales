export function validateGovernanceEvidence(
  evidence: Record<string, unknown>,
  options?: { expectedCommit?: string; expectedScope?: string; now?: Date },
): string[];
