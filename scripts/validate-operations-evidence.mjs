import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMAT = 'meddata-operations-evidence/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_VALIDITY_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_REVIEW_AGE_MS = 93 * 24 * 60 * 60 * 1_000;
const REQUIRED_ROLES = [
  'releaseManager',
  'databaseOwner',
  'securityLead',
  'dataProtectionLead',
  'clinicalQaLead',
  'scientificQaLead',
  'supportOwner',
  'incidentCommander',
];
const REQUIRED_RUNBOOKS = [
  'incident',
  'monitoring',
  'backup',
  'restore',
  'rollback',
  'release',
];

const clean = (value) => typeof value === 'string' ? value.trim() : '';
const validReference = (value) => clean(value).length >= 6
  && !/placeholder|todo|a[- ]?completer|projet|draft|pending|inconnu|unknown/i.test(value);

const validPastDate = (value, nowMs, issuedAtMs) => {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) && parsed <= nowMs && (!Number.isFinite(issuedAtMs) || parsed <= issuedAtMs);
};

export function validateOperationsEvidence(evidence, { expectedCommit, now = new Date() } = {}) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['La preuve operationnelle doit etre un objet JSON.'];
  }
  if (evidence.format !== FORMAT) errors.push(`format doit valoir ${FORMAT}.`);
  if (evidence.environment !== 'production') errors.push('environment doit valoir production.');

  const commit = clean(evidence.commit);
  if (!GIT_SHA.test(commit)) errors.push('commit doit etre un SHA Git complet.');
  if (expectedCommit && commit !== expectedCommit) errors.push('Le manifeste operationnel ne correspond pas au commit promu.');

  const nowMs = now.getTime();
  const issuedAtMs = Date.parse(evidence.issuedAt ?? '');
  const expiresAtMs = Date.parse(evidence.expiresAt ?? '');
  if (!Number.isFinite(issuedAtMs) || issuedAtMs > nowMs + 5 * 60 * 1_000) {
    errors.push('issuedAt est invalide ou futur.');
  }
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    errors.push('Le manifeste operationnel est expire ou sans expiration valide.');
  }
  if (Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs)
      && expiresAtMs - issuedAtMs > MAX_VALIDITY_MS) {
    errors.push('La validite du manifeste operationnel depasse 90 jours.');
  }

  const roles = evidence.roles ?? {};
  for (const role of REQUIRED_ROLES) {
    const assignment = roles[role] ?? {};
    if (!validReference(assignment.primaryAssignmentReference)) {
      errors.push(`roles.${role}.primaryAssignmentReference est absente ou provisoire.`);
    }
    if (!validReference(assignment.alternateAssignmentReference)) {
      errors.push(`roles.${role}.alternateAssignmentReference est absente ou provisoire.`);
    }
    if (clean(assignment.primaryAssignmentReference) === clean(assignment.alternateAssignmentReference)) {
      errors.push(`roles.${role}: titulaire et suppleant doivent etre distincts.`);
    }
    for (const field of ['assignmentEvidenceSha256', 'trainingEvidenceSha256', 'runbookAcceptanceSha256']) {
      if (!SHA256.test(clean(assignment[field]))) errors.push(`roles.${role}.${field} est invalide.`);
    }
  }

  const onCall = evidence.onCall ?? {};
  if (onCall.coverage !== '24x7') errors.push('onCall.coverage doit valoir 24x7.');
  if (!validReference(onCall.scheduleReference)) errors.push('onCall.scheduleReference est absente ou provisoire.');
  if (!validReference(onCall.contactDirectoryReference)) {
    errors.push('onCall.contactDirectoryReference est absente ou provisoire.');
  }
  if (!validReference(onCall.notificationAuthorityReference)) {
    errors.push('onCall.notificationAuthorityReference est absente ou provisoire.');
  }
  if (!Number.isInteger(onCall.criticalAckMinutes) || onCall.criticalAckMinutes < 1
      || onCall.criticalAckMinutes > 15) {
    errors.push('onCall.criticalAckMinutes doit etre compris entre 1 et 15.');
  }
  if (!Number.isInteger(onCall.criticalEscalationMinutes) || onCall.criticalEscalationMinutes < 1
      || onCall.criticalEscalationMinutes > 30) {
    errors.push('onCall.criticalEscalationMinutes doit etre compris entre 1 et 30.');
  }
  if (!validPastDate(onCall.lastDrillAt, nowMs, issuedAtMs)
      || nowMs - Date.parse(onCall.lastDrillAt ?? '') > MAX_REVIEW_AGE_MS) {
    errors.push('onCall.lastDrillAt est absent ou date de plus de 93 jours.');
  }
  if (!SHA256.test(clean(onCall.drillEvidenceSha256))) errors.push('onCall.drillEvidenceSha256 est invalide.');
  if (onCall.drillResult !== 'passed') errors.push('onCall.drillResult doit valoir passed.');

  const support = evidence.support ?? {};
  for (const field of ['ticketingReference', 'capacityPlanReference', 'serviceLevelReference']) {
    if (!validReference(support[field])) errors.push(`support.${field} est absent ou provisoire.`);
  }
  for (const field of ['capacityEvidenceSha256', 'serviceLevelEvidenceSha256', 'escalationEvidenceSha256']) {
    if (!SHA256.test(clean(support[field]))) errors.push(`support.${field} est invalide.`);
  }
  if (!Number.isInteger(support.concurrentCriticalCapacity) || support.concurrentCriticalCapacity < 1) {
    errors.push('support.concurrentCriticalCapacity doit etre un entier positif.');
  }

  const qa = evidence.qa ?? {};
  if (qa.result !== 'passed') errors.push('qa.result doit valoir passed.');
  if (qa.criticalFindingsOpen !== 0) errors.push('qa.criticalFindingsOpen doit valoir 0.');
  if (qa.highFindingsOpen !== 0) errors.push('qa.highFindingsOpen doit valoir 0.');
  if (!validPastDate(qa.clinicalSessionAt, nowMs, issuedAtMs)) errors.push('qa.clinicalSessionAt est invalide.');
  if (!validPastDate(qa.scientificReviewAt, nowMs, issuedAtMs)) errors.push('qa.scientificReviewAt est invalide.');
  for (const field of ['clinicalSessionEvidenceSha256', 'scientificReviewEvidenceSha256', 'protocolSha256']) {
    if (!SHA256.test(clean(qa[field]))) errors.push(`qa.${field} est invalide.`);
  }

  const access = evidence.access ?? {};
  for (const field of ['mfaReviewAt', 'leastPrivilegeReviewAt']) {
    if (!validPastDate(access[field], nowMs, issuedAtMs)
        || nowMs - Date.parse(access[field] ?? '') > MAX_REVIEW_AGE_MS) {
      errors.push(`access.${field} est absent ou date de plus de 93 jours.`);
    }
  }
  if (!SHA256.test(clean(access.mfaEvidenceSha256))) errors.push('access.mfaEvidenceSha256 est invalide.');
  if (!SHA256.test(clean(access.leastPrivilegeEvidenceSha256))) {
    errors.push('access.leastPrivilegeEvidenceSha256 est invalide.');
  }
  if (!Number.isInteger(access.privilegedAccountsReviewed) || access.privilegedAccountsReviewed < 1) {
    errors.push('access.privilegedAccountsReviewed doit etre un entier positif.');
  }
  if (access.stalePrivilegedAccounts !== 0) errors.push('access.stalePrivilegedAccounts doit valoir 0.');
  if (access.accountsWithoutMfa !== 0) errors.push('access.accountsWithoutMfa doit valoir 0.');

  const runbooks = evidence.runbooks ?? {};
  for (const runbook of REQUIRED_RUNBOOKS) {
    if (!SHA256.test(clean(runbooks[`${runbook}Sha256`]))) {
      errors.push(`runbooks.${runbook}Sha256 est invalide.`);
    }
  }
  return errors;
}

async function main() {
  const file = process.argv.find((argument) => argument.startsWith('--file='))?.slice(7);
  const expectedCommit = process.argv.find((argument) => argument.startsWith('--commit='))?.slice(9);
  if (!file || !GIT_SHA.test(expectedCommit ?? '')) {
    throw new Error('Usage: validate-operations-evidence.mjs --file=<preuve.json> --commit=<SHA40>.');
  }
  const bytes = await readFile(resolve(file));
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Le fichier operationnel depasse 64 Kio.');
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Le fichier operationnel n est pas un JSON valide.');
  }
  const errors = validateOperationsEvidence(evidence, { expectedCommit });
  if (errors.length) throw new Error(`Preuve operationnelle refusee:\n- ${errors.join('\n- ')}`);
  console.log(`Preuve operationnelle: OK (commit ${expectedCommit.slice(0, 12)}, references et empreintes uniquement).`);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Validation operationnelle impossible.');
    process.exitCode = 1;
  });
}
