export type ClamavVersion = {
  engineVersion: string;
  signatureDatabaseVersion: string;
  signatureDatabaseUpdatedAt: string;
};

export function parseClamavVersion(raw: unknown): ClamavVersion | null;
