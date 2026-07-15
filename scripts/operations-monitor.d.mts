export function healthUrlForScan(value: string): string;
export function validateMonitorConfiguration(env?: Record<string, string | undefined>): {
  target: 'staging' | 'production';
  projectRef: string;
  appUrl: string;
  supabaseUrl: string;
  anonKey: string;
  scanUrl: string;
  scanToken: string;
};

