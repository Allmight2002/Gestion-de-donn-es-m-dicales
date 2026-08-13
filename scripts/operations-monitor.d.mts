export function healthUrlForScan(value: string): string;
export function validateMonitorConfiguration(env?: Record<string, string | undefined>): {
  target: 'staging' | 'production';
  projectRef: string;
  appUrl: string;
  supabaseUrl: string;
  anonKey: string;
  inspectionMode: 'strict' | 'paused';
  inspectionPaused: boolean;
  // Nuls quand l'inspection est suspendue : aucune sonde antivirus n'est alors emise.
  scanUrl: string | null;
  scanToken: string | null;
  maxSignatureAgeHours: number | null;
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
