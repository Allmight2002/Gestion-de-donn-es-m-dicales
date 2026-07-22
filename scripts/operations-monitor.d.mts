export function healthUrlForScan(value: string): string;
export function validateMonitorConfiguration(env?: Record<string, string | undefined>): {
  target: 'staging' | 'production';
  projectRef: string;
  appUrl: string;
  supabaseUrl: string;
  anonKey: string;
  scanUrl: string;
  scanToken: string;
  maxSignatureAgeHours: number;
  frontendStorageStatePath: string | null;
};

export type MonitorConfiguration = ReturnType<typeof validateMonitorConfiguration>;
export type MonitorCheck = {
  name: string;
  ok: boolean;
  httpStatus?: number;
  errorCode?: string;
  durationMs: number;
};

export function monitor(
  config: MonitorConfiguration,
  options?: { frontendCookieHeader?: string },
): Promise<MonitorCheck[]>;
