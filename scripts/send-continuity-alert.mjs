import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOperationsAlert, deliverOperationsAlert, validateAlertConfiguration } from './send-operations-alert.mjs';

export function assessContinuityJobs(jobs, target) {
  if (!['staging', 'production'].includes(target) || !Array.isArray(jobs)) {
    throw new Error('Etat de continuite invalide.');
  }
  return ['backup', 'preserve-copy'].map((name) => {
    const matches = jobs.filter((job) => job?.name === `${name} (${target})`);
    return {
      name: name === 'backup' ? 'continuity-backup' : 'continuity-durable-copy',
      ok: matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success',
      errorCode: name === 'backup' ? 'backup-failed' : 'durable-copy-failed',
    };
  });
}

async function main() {
  const config = validateAlertConfiguration();
  const { GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt } = process.env;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')
      || !/^\d+$/.test(runId ?? '') || !/^\d+$/.test(attempt ?? '')) {
    throw new Error('Identifiants du run absents.');
  }
  let checks;
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`, {
      headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json' },
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('API indisponible.');
    const payload = await response.json();
    if (payload.total_count > 100) throw new Error('Pagination incomplete.');
    checks = assessContinuityJobs(payload.jobs, config.target);
  } catch {
    checks = [{ name: 'continuity-status', ok: false, errorCode: 'github-api-unavailable' }];
  }
  const drill = process.env.MONITOR_ALERT_DRILL === 'true';
  if (checks.every((check) => check.ok) && !drill) {
    console.log('Sauvegarde et copie durable: OK; aucune alerte requise.');
    return;
  }
  const alert = buildOperationsAlert({
    format: 'meddata-operations-monitor/v1', target: config.target,
    observedAt: new Date().toISOString(), checks,
  }, { target: config.target, repository, runId, drill });
  await deliverOperationsAlert(config, alert);
  console.log('Alerte acceptee par HTTP; reception par le destinataire a confirmer separement.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Controle ou livraison de l alerte impossible (detail masque).');
    process.exitCode = 1;
  });
}
