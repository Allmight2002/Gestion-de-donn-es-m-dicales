import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateContinuityPolicy(env = process.env) {
  if (!['staging', 'production'].includes(env.BACKUP_TARGET)
      && !(env.BACKUP_TARGET === 'isolated-local' && env.RECOVERY_ALLOW_LOCAL_BACKUP === 'true'
        && env.RECOVERY_DATA_CLASSIFICATION === 'fictitious-only')) {
    throw new Error('Cible de continuite invalide.');
  }
  const keyId = env.BACKUP_KEY_ID ?? '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(keyId)) {
    throw new Error('BACKUP_KEY_ID doit identifier une version de cle en coffre.');
  }
  const retention = env.BACKUP_RETENTION_DAYS ?? '30';
  if (!/^\d+$/.test(retention) || Number(retention) < 1 || Number(retention) > 90) {
    throw new Error('BACKUP_RETENTION_DAYS doit etre compris entre 1 et 90 jours (limite organisationnelle a verifier).');
  }
  return { keyId, retentionDays: Number(retention) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateContinuityPolicy();
    console.log('Politique de continuite: OK (identifiant de cle et retention).');
  } catch {
    console.error('Politique de continuite invalide; verifier cible, BACKUP_KEY_ID et BACKUP_RETENTION_DAYS.');
    process.exitCode = 1;
  }
}
