export type ScanVerdict =
  | { status: 'clean'; raw: string }
  | { status: 'infected'; signature: string; raw: string }
  | { status: 'error'; raw: string };

export function parseScan(raw: string): ScanVerdict;
