export type AlertConfiguration = { webhookUrl: string; target: 'staging' | 'production' };

export function validateAlertConfiguration(
  env?: Record<string, string | undefined>,
): AlertConfiguration;
export function buildOperationsAlert(
  evidence: unknown,
  options?: { target?: string; runId?: string; repository?: string; drill?: boolean },
): Record<string, unknown>;
export function deliverOperationsAlert(
  config: AlertConfiguration,
  alert: Record<string, unknown>,
  options?: { fetchImpl?: typeof fetch },
): Promise<void>;
