export function parseClamavVersion(raw) {
  const normalized = String(raw ?? '').replaceAll('\0', '').trim();
  const match = /^ClamAV\s+([^/\s]+)\/(\d+)\/(.+)$/.exec(normalized);
  if (!match) return null;

  const updatedAtMs = Date.parse(match[3]);
  if (!Number.isFinite(updatedAtMs)) return null;

  return {
    engineVersion: match[1],
    signatureDatabaseVersion: match[2],
    signatureDatabaseUpdatedAt: new Date(updatedAtMs).toISOString(),
  };
}
