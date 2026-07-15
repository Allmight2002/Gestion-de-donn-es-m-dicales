export type ScanVerdict =
  | { status: 'clean' }
  | { status: 'infected'; signature: string }
  | { status: 'error' };

export function parseScan(raw: string): ScanVerdict;
