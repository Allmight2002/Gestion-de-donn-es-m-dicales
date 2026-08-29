export type DumpFailureCategory =
  | 'timeout'
  | 'disk'
  | 'authentication'
  | 'permission'
  | 'docker'
  | 'connectivity'
  | 'cli-exit';

export type DumpExecutor = (
  command: string,
  arguments_: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    encoding: 'utf8';
    stdio: ['ignore', 'pipe', 'pipe'];
    timeout: number;
    windowsHide: boolean;
  },
) => unknown;

export const COORDINATED_DUMP_IMAGE: Readonly<{
  cliVersion: string;
  dbMajorVersion: number;
  repository: string;
  mirrorRepository: string;
  tag: string;
  digest: string;
}>;

export function isSessionPoolerDatabaseUrl(value: string | undefined): boolean;

export function dumpSubprocessEnvironment(
  source?: Partial<Record<string, string | undefined>>,
): Record<string, string>;

export function classifyDumpFailure(error: unknown): DumpFailureCategory;
export function dumpFailureSignals(error: unknown): string[];

export function prepareDumpImage(options?: {
  execute?: DumpExecutor;
  sourceEnv?: Partial<Record<string, string | undefined>>;
  attempts?: number;
  installedCliVersion?: string;
  configuredDbMajorVersion?: number;
}): Promise<'skipped' | 'cached' | 'primary' | 'mirror'>;

export function withIsolatedSupabaseWorkdir<T>(
  action: (workdir: string) => T | Promise<T>,
): Promise<T>;

export function runSupabaseDump(
  databaseUrl: string,
  file: string,
  extraArguments: string[],
  stage: 'roles' | 'schema' | 'data' | 'public-data',
  options?: {
    execute?: DumpExecutor;
    sourceEnv?: Partial<Record<string, string | undefined>>;
    workdir?: string;
  },
): void;

export function writeAtomicBackupDirectory<T>(
  destination: string,
  build: (partial: string) => T | Promise<T>,
  options?: { suffix?: string },
): Promise<T>;
