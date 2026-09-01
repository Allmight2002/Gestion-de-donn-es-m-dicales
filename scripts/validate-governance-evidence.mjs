import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMAT = 'meddata-governance-evidence/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const MAX_FILE_BYTES = 64 * 1024;
const REQUIRED_APPROVALS = [
  'dataController',
  'legalCounsel',
  'dataProtectionAuthority',
  'clinicalAuthority',
  'scientificAuthority',
  'ethicsAuthority',
  'operationsAuthority',
  'securityAuthority',
];
const REQUIRED_CONTRACTS = ['supabase', 'vercel', 'antivirusOperator', 'emailProvider'];

const clean = (value) => typeof value === 'string' ? value.trim() : '';
const validReference = (value) => clean(value).length >= 6
  && !/placeholder|todo|a[- ]?completer|projet|draft|pending/i.test(value);

export function validateGovernanceEvidence(evidence, {
  expectedCommit,
  expectedScope = 'production-complete',
  now = new Date(),
} = {}) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['La preuve de gouvernance doit etre un objet JSON.'];
  }
  if (evidence.format !== FORMAT) errors.push(`format doit valoir ${FORMAT}.`);
  if (evidence.environment !== 'production') errors.push('environment doit valoir production.');
  if (!['tchad', 'cameroun'].includes(evidence.country)) errors.push('country doit valoir tchad ou cameroun.');
  if (evidence.usageScope !== expectedScope) errors.push(`usageScope doit valoir ${expectedScope}.`);

  const commit = clean(evidence.commit);
  if (!GIT_SHA.test(commit)) errors.push('commit doit etre un SHA Git complet.');
  if (expectedCommit && commit !== expectedCommit) errors.push('Le manifeste ne correspond pas au commit promu.');

  const issuedAtMs = Date.parse(evidence.issuedAt ?? '');
  const expiresAtMs = Date.parse(evidence.expiresAt ?? '');
  const nowMs = now.getTime();
  if (!Number.isFinite(issuedAtMs) || issuedAtMs > nowMs + 5 * 60 * 1_000) {
    errors.push('issuedAt est invalide ou futur.');
  }
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) errors.push('Le manifeste est expire ou sans expiration valide.');
  if (Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs)
      && expiresAtMs - issuedAtMs > 366 * 24 * 60 * 60 * 1_000) {
    errors.push('La validite du manifeste depasse un an.');
  }

  const approvals = evidence.approvals ?? {};
  for (const role of REQUIRED_APPROVALS) {
    const approval = approvals[role] ?? {};
    if (approval.decision !== 'approved') errors.push(`approvals.${role}.decision doit valoir approved.`);
    if (!validReference(approval.reference)) errors.push(`approvals.${role}.reference est absente ou provisoire.`);
    if (!SHA256.test(clean(approval.evidenceSha256))) errors.push(`approvals.${role}.evidenceSha256 est invalide.`);
    const signedAtMs = Date.parse(approval.signedAt ?? '');
    if (!Number.isFinite(signedAtMs) || (Number.isFinite(issuedAtMs) && signedAtMs > issuedAtMs)) {
      errors.push(`approvals.${role}.signedAt est invalide.`);
    }
  }

  const contracts = evidence.contracts ?? {};
  for (const provider of REQUIRED_CONTRACTS) {
    const contract = contracts[provider] ?? {};
    if (contract.status !== 'signed') errors.push(`contracts.${provider}.status doit valoir signed.`);
    if (!validReference(contract.reference)) errors.push(`contracts.${provider}.reference est absente ou provisoire.`);
    if (!SHA256.test(clean(contract.evidenceSha256))) errors.push(`contracts.${provider}.evidenceSha256 est invalide.`);
  }

  const controls = evidence.controls ?? {};
  for (const name of [
    'dpiaEvidenceSha256',
    'dataResidencyEvidenceSha256',
    'incidentProcedureEvidenceSha256',
    'riskDecisionEvidenceSha256',
  ]) {
    if (!SHA256.test(clean(controls[name]))) errors.push(`controls.${name} est invalide.`);
  }
  if (controls.residualRiskDecision !== 'accepted-low-only') {
    errors.push('controls.residualRiskDecision doit valoir accepted-low-only.');
  }

  return errors;
}

async function main() {
  const file = process.argv.find((argument) => argument.startsWith('--file='))?.slice(7);
  const expectedCommit = process.argv.find((argument) => argument.startsWith('--commit='))?.slice(9);
  const expectedScope = process.argv.find((argument) => argument.startsWith('--scope='))?.slice(8)
    ?? 'production-complete';
  if (!file || !GIT_SHA.test(expectedCommit ?? '')) {
    throw new Error('Usage: validate-governance-evidence.mjs --file=<preuve.json> --commit=<SHA40> [--scope=production-complete].');
  }
  const bytes = await readFile(resolve(file));
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Le fichier de gouvernance depasse 64 Kio.');
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Le fichier de gouvernance n est pas un JSON valide.');
  }
  const errors = validateGovernanceEvidence(evidence, { expectedCommit, expectedScope });
  if (errors.length) throw new Error(`Preuve de gouvernance refusee:\n- ${errors.join('\n- ')}`);
  console.log(`Preuve de gouvernance: OK (commit ${expectedCommit.slice(0, 12)}, references et empreintes uniquement).`);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Validation de gouvernance impossible.');
    process.exitCode = 1;
  });
}
