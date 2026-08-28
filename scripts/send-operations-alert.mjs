import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MONITOR_FORMAT = 'meddata-operations-monitor/v1';
const ALERT_FORMAT = 'meddata-operations-alert/v1';
const MAX_EVIDENCE_BYTES = 64 * 1024;
const CHECK_NAME = /^[a-z0-9-]{1,64}$/;
const ERROR_CODE = /^[a-z0-9-]{1,64}$/;

const clean = (value) => value?.trim() ?? '';

export function validateAlertConfiguration(env = process.env) {
  const raw = clean(env.MONITOR_ALERT_WEBHOOK_URL);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MONITOR_ALERT_WEBHOOK_URL doit etre une URL HTTPS valide.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('MONITOR_ALERT_WEBHOOK_URL doit etre HTTPS, sans identifiants ni fragment.');
  }
  const target = clean(env.MONITOR_TARGET);
  if (!['staging', 'production'].includes(target)) {
    throw new Error('MONITOR_TARGET doit valoir staging ou production.');
  }
  return { webhookUrl: url.toString(), target };
}

function safeCheck(check) {
  return {
    name: CHECK_NAME.test(check?.name ?? '') ? check.name : 'unknown-check',
    errorCode: ERROR_CODE.test(check?.errorCode ?? '') ? check.errorCode : 'probe-failed',
  };
}

export function buildOperationsAlert(evidence, {
  target,
  runId = '',
  repository = '',
  drill = false,
} = {}) {
  const validEvidence = evidence?.format === MONITOR_FORMAT
    && evidence?.target === target
    && Array.isArray(evidence?.checks);
  const failedChecks = validEvidence
    ? evidence.checks.filter((check) => check?.ok !== true).map(safeCheck)
    : [{ name: 'monitor-startup', errorCode: 'evidence-unavailable' }];
  return {
    format: ALERT_FORMAT,
    event: drill ? 'alert-drill' : 'monitor-failure',
    target,
    observedAt: validEvidence && Number.isFinite(Date.parse(evidence.observedAt))
      ? evidence.observedAt
      : new Date().toISOString(),
    failedChecks: drill && failedChecks.length === 0
      ? [{ name: 'synthetic-drill', errorCode: 'expected-test-alert' }]
      : failedChecks,
    run: {
      id: /^\d+$/.test(runId) ? runId : null,
      repository: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ? repository : null,
    },
  };
}

async function readEvidence(path) {
  if (!path) return null;
  try {
    const bytes = await readFile(resolve(path));
    if (bytes.length > MAX_EVIDENCE_BYTES) return null;
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

export async function deliverOperationsAlert(config, alert, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(config.webhookUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Livraison de l alerte impossible (detail masque).');
  }
  await response.arrayBuffer();
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Livraison de l alerte refusee (HTTP ${response.status}).`);
  }
}

async function main() {
  const config = validateAlertConfiguration();
  if (process.argv.includes('--check-config')) {
    console.log(`Destination d alerte ${config.target}: configuree (valeur masquee).`);
    return;
  }
  const file = process.argv.find((argument) => argument.startsWith('--file='))?.slice(7);
  const evidence = await readEvidence(file);
  const alert = buildOperationsAlert(evidence, {
    target: config.target,
    runId: clean(process.env.GITHUB_RUN_ID),
    repository: clean(process.env.GITHUB_REPOSITORY),
    drill: process.env.MONITOR_ALERT_DRILL === 'true',
  });
  await deliverOperationsAlert(config, alert);
  console.log(`Alerte ${alert.event} ${config.target}: livree (contenu expurge).`);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Alerte operationnelle impossible.');
    process.exitCode = 1;
  });
}
