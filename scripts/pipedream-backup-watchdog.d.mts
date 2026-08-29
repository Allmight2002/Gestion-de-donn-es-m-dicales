export interface BackupWatchdogResult {
  ok: boolean;
  target: 'staging';
  check: 'continuity-backup';
  observedAt: string;
  maxAgeHours: number;
  errorCode: 'backup-missing' | 'github-api-unavailable' | 'expected-test-alert' | null;
  latestSuccessAt: string | null;
  runId: string | null;
  drill: boolean;
}

export interface BackupWatchdogOptions {
  token?: string;
  now?: Date | string | number;
  fetchImpl?: typeof fetch;
  forceTestAlert?: boolean;
}

export interface BackupWatchdogEmail {
  subject: string;
  text: string;
}

export function checkBackupFreshness(
  options?: BackupWatchdogOptions,
): Promise<BackupWatchdogResult>;

export function buildWatchdogEmail(result: BackupWatchdogResult): BackupWatchdogEmail;

export const pipedreamComponent: unknown;

declare const component: unknown;
export default component;
