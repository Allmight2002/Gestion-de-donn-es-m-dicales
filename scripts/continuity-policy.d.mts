export function validateContinuityPolicy(env?: Partial<Record<string, string | undefined>>): {
  keyId: string;
  retentionDays: number;
};
