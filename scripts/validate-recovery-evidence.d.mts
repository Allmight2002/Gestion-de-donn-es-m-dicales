export type RecoveryEvidence = Record<string, unknown>;

export function validateRecoveryEvidence(
  evidence: RecoveryEvidence,
  options?: { expectedCommit?: string; now?: Date; maxAgeHours?: number },
): string[];
