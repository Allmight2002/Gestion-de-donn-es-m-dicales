import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMAT = 'meddata-recovery-evidence/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const MAX_FILE_BYTES = 64 * 1024;
const REQUIRED_JOURNEYS = [
  'authentication',
  'authorizationDenial',
  'cleanUpload',
  'eicarRejection',
  'importRetry',
  'scientificExport',
  'auditTrail',
];

const clean = (value) => typeof value === 'string' ? value.trim() : '';

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateRecoveryEvidence(evidence, {
  expectedCommit,
  now = new Date(),
  maxAgeHours = 24 * 30,
} = {}) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['La preuve de reprise doit etre un objet JSON.'];
  }
  if (evidence.format !== FORMAT) errors.push(`format doit valoir ${FORMAT}.`);
  if (evidence.environment !== 'staging-isolated') {
    errors.push('environment doit valoir staging-isolated.');
  }
  if (evidence.dataClassification !== 'fictitious-only') {
    errors.push('dataClassification doit valoir fictitious-only.');
  }

  const commit = clean(evidence.commit);
  if (!GIT_SHA.test(commit)) errors.push('commit doit etre un SHA Git complet.');
  if (expectedCommit && commit !== expectedCommit) errors.push('La preuve ne correspond pas au commit attendu.');

  const observedAtMs = Date.parse(evidence.observedAt ?? '');
  const nowMs = now.getTime();
  if (!Number.isFinite(observedAtMs)) errors.push('observedAt doit etre une date ISO valide.');
  else if (observedAtMs > nowMs + 5 * 60 * 1_000) errors.push('observedAt est dans le futur.');
  else if (nowMs - observedAtMs > maxAgeHours * 60 * 60 * 1_000) errors.push('La preuve de reprise est perimee.');

  const source = evidence.source ?? {};
  if (!SHA256.test(clean(source.backupSetSha256))) errors.push('source.backupSetSha256 est invalide.');
  if (source.backupVerified !== true) errors.push('Le backup source doit etre verifie avant restauration.');
  if (source.backupCommit !== commit) errors.push('Le backup source ne correspond pas au commit exerce.');

  const isolation = evidence.isolation ?? {};
  if (!['ephemeral-local', 'ephemeral-cloud'].includes(isolation.targetKind)) {
    errors.push('La cible doit etre locale ou cloud ephemere et isolee.');
  }
  if (isolation.productionConnected !== false || isolation.targetWasEmpty !== true) {
    errors.push('La cible doit etre vide et sans connexion production.');
  }
  if (!SHA256.test(clean(isolation.targetFingerprintSha256))) {
    errors.push('isolation.targetFingerprintSha256 est invalide.');
  }

  const timing = evidence.timing ?? {};
  const startedAtMs = Date.parse(timing.startedAt ?? '');
  const completedAtMs = Date.parse(timing.completedAt ?? '');
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs) || completedAtMs <= startedAtMs) {
    errors.push('La fenetre de reprise est invalide.');
  }
  for (const key of ['observedRpoSeconds', 'observedRtoSeconds', 'approvedRpoSeconds', 'approvedRtoSeconds']) {
    if (!finiteNonNegative(timing[key])) errors.push(`timing.${key} doit etre un nombre positif ou nul.`);
  }
  if (finiteNonNegative(timing.observedRpoSeconds)
      && finiteNonNegative(timing.approvedRpoSeconds)
      && timing.observedRpoSeconds > timing.approvedRpoSeconds) {
    errors.push('Le RPO observe depasse le RPO approuve.');
  }
  if (finiteNonNegative(timing.observedRtoSeconds)
      && finiteNonNegative(timing.approvedRtoSeconds)
      && timing.observedRtoSeconds > timing.approvedRtoSeconds) {
    errors.push('Le RTO observe depasse le RTO approuve.');
  }
  if (!SHA256.test(clean(timing.objectivesApprovalSha256))) {
    errors.push('La preuve d approbation RPO/RTO est absente.');
  }

  const restore = evidence.restore ?? {};
  for (const key of ['database', 'auth', 'storage', 'rlsEnabled', 'schemaMatches']) {
    if (restore[key] !== true) errors.push(`restore.${key} doit etre vrai.`);
  }
  for (const key of ['foreignKeysChecked', 'objectsExpected', 'objectsRestored']) {
    if (!positiveInteger(restore[key])) errors.push(`restore.${key} doit etre un entier strictement positif.`);
  }
  if (restore.objectsExpected !== restore.objectsRestored) errors.push('Tous les objets attendus ne sont pas restaures.');
  if (restore.hashMismatches !== 0) errors.push('La restauration contient des divergences de hash.');
  if (restore.orphanCount !== 0) errors.push('La restauration contient des orphelins referentiels.');

  const recovery = evidence.recovery ?? {};
  for (const key of ['frontendRollback', 'edgeRollback', 'storagePolicyReapply', 'forwardMigration']) {
    if (recovery[key] !== true) errors.push(`recovery.${key} doit etre vrai.`);
  }

  const journeys = evidence.journeys ?? {};
  for (const journey of REQUIRED_JOURNEYS) {
    if (journeys[journey] !== true) errors.push(`journeys.${journey} doit etre vrai.`);
  }

  const approvals = evidence.approvals ?? {};
  for (const role of ['releaseManager', 'continuityOwner']) {
    if (!SHA256.test(clean(approvals[role]?.evidenceSha256))) {
      errors.push(`approvals.${role}.evidenceSha256 est invalide.`);
    }
    if (!clean(approvals[role]?.reference) || /placeholder|todo|a[- ]?completer/i.test(approvals[role]?.reference)) {
      errors.push(`approvals.${role}.reference est absente ou provisoire.`);
    }
  }

  return errors;
}

async function main() {
  const file = process.argv.find((argument) => argument.startsWith('--file='))?.slice(7);
  const expectedCommit = process.argv.find((argument) => argument.startsWith('--commit='))?.slice(9);
  if (!file || !expectedCommit || !GIT_SHA.test(expectedCommit)) {
    throw new Error('Usage: validate-recovery-evidence.mjs --file=<preuve.json> --commit=<SHA40>.');
  }
  const bytes = await readFile(resolve(file));
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Le fichier de preuve depasse 64 Kio.');
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Le fichier de preuve n est pas un JSON valide.');
  }
  const errors = validateRecoveryEvidence(evidence, { expectedCommit });
  if (errors.length) throw new Error(`Preuve de reprise refusee:\n- ${errors.join('\n- ')}`);
  console.log(`Preuve de reprise: OK (commit ${expectedCommit.slice(0, 12)}, contenu sensible absent).`);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Validation de reprise impossible.');
    process.exitCode = 1;
  });
}
