export type VercelStorageCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: true;
  secure: true;
  sameSite: 'Lax';
};

export type VercelStorageState = {
  cookies: VercelStorageCookie[];
  origins: [];
};

export function validatedVercelDeploymentHostname(rawUrl: string): string;
export function createVercelStorageState(
  cookieJar: string,
  rawDeploymentUrl: string,
  nowSeconds?: number,
): VercelStorageState;
export function writeVercelStorageState(
  cookieJarPath: string,
  outputPath: string,
  rawDeploymentUrl: string,
): Promise<{ hostname: string; cookieCount: number }>;
