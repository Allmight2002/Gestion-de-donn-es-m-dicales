export interface ScannerVerificationInput {
  scanUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface QueryResult {
  rowCount?: number | null;
  rows: Array<Record<string, unknown>>;
}

export interface StrictInspectionClient {
  connect(): Promise<void>;
  query(sql: string): Promise<QueryResult>;
  end(): Promise<void>;
}

export interface StrictActivationInput {
  dbUrl: string;
  createClient?: (dbUrl: string) => Promise<StrictInspectionClient>;
}

export function verifyStrictScanner(input: ScannerVerificationInput): Promise<void>;
export function activateStrictInspection(input: StrictActivationInput): Promise<void>;
export function pauseServerInspection(input: StrictActivationInput): Promise<void>;
export function runStrictActivation(input: { target: string; env?: NodeJS.ProcessEnv }): Promise<void>;
export function runInspectionPause(input: { target: string; env?: NodeJS.ProcessEnv }): Promise<void>;
