import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const TRACKED_SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const REJECTED_SEVERITIES = new Set(['moderate', 'high', 'critical']);

const clean = (value) => typeof value === 'string' ? value.trim() : '';

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateDependencyAudit(report, { scope = 'staging' } = {}) {
  const errors = [];

  if (!['staging', 'production'].includes(scope)) {
    return {
      errors: ['Le scope audit doit valoir staging ou production.'],
      acceptedAdvisories: [],
      scope,
    };
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return {
      errors: ['Le rapport npm audit doit etre un objet JSON.'],
      acceptedAdvisories: [],
      scope,
    };
  }
  if (report.auditReportVersion !== 2) {
    errors.push('La version du rapport npm audit doit valoir 2.');
  }

  const vulnerabilities = report.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object' || Array.isArray(vulnerabilities)) {
    errors.push('Le rapport npm audit ne contient pas la liste des vulnerabilites.');
    return { errors, acceptedAdvisories: [], scope };
  }

  const metadataCounts = report.metadata?.vulnerabilities;
  if (!metadataCounts || typeof metadataCounts !== 'object' || Array.isArray(metadataCounts)) {
    errors.push('Le rapport npm audit ne contient pas les compteurs de vulnerabilites.');
  } else {
    for (const severity of TRACKED_SEVERITIES) {
      if (!validCount(metadataCounts[severity])) {
        errors.push(`Le compteur npm ${severity} est absent ou invalide.`);
      }
    }
    if (!validCount(metadataCounts.total)) {
      errors.push('Le compteur npm total est absent ou invalide.');
    }
  }

  const aggregateCounts = Object.fromEntries(TRACKED_SEVERITIES.map((severity) => [severity, 0]));
  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    if (!vulnerability || typeof vulnerability !== 'object' || Array.isArray(vulnerability)) {
      errors.push(`Entree npm audit invalide pour ${packageName}.`);
      continue;
    }

    const severity = clean(vulnerability.severity).toLowerCase();
    if (!TRACKED_SEVERITIES.includes(severity)) {
      errors.push(`Severite npm inconnue pour ${packageName}.`);
      continue;
    }
    aggregateCounts[severity] += 1;

    if (REJECTED_SEVERITIES.has(severity)) {
      errors.push(`${packageName} conserve une vulnerabilite ${severity}.`);
    }
  }

  if (metadataCounts && typeof metadataCounts === 'object' && !Array.isArray(metadataCounts)) {
    for (const severity of TRACKED_SEVERITIES) {
      if (validCount(metadataCounts[severity]) && metadataCounts[severity] !== aggregateCounts[severity]) {
        errors.push(`Le compteur npm ${severity} ne correspond pas aux entrees detaillees.`);
      }
    }
    const aggregateTotal = Object.values(aggregateCounts).reduce((sum, count) => sum + count, 0);
    if (validCount(metadataCounts.total) && metadataCounts.total !== aggregateTotal) {
      errors.push('Le compteur npm total ne correspond pas aux entrees detaillees.');
    }
  }

  return {
    errors: [...new Set(errors)],
    acceptedAdvisories: [],
    scope,
  };
}

export function assessAuditExecution(execution, options = {}) {
  if (!execution || typeof execution !== 'object') {
    return { errors: ['Execution npm audit indisponible.'], acceptedAdvisories: [], scope: options.scope ?? 'staging' };
  }
  if (execution.error || !Number.isInteger(execution.status) || ![0, 1].includes(execution.status)) {
    return { errors: ['Execution npm audit indisponible ou interrompue.'], acceptedAdvisories: [], scope: options.scope ?? 'staging' };
  }

  let report;
  try {
    report = JSON.parse(typeof execution.stdout === 'string' ? execution.stdout : '');
  } catch {
    return { errors: ['La sortie npm audit n est pas un JSON valide.'], acceptedAdvisories: [], scope: options.scope ?? 'staging' };
  }
  return validateDependencyAudit(report, options);
}

function scopeFromArguments(args) {
  const value = args.find((argument) => argument.startsWith('--scope='))?.slice(8);
  if (!value || !['staging', 'production'].includes(value)) {
    throw new Error('Usage: validate-dependency-audit.mjs --scope=staging|production.');
  }
  return value;
}

function main() {
  const scope = scopeFromArguments(process.argv.slice(2));
  const npmExecPath = clean(process.env.npm_execpath);
  const command = npmExecPath ? process.execPath : 'npm';
  const args = npmExecPath ? [npmExecPath, 'audit', '--json'] : ['audit', '--json'];
  const execution = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
    shell: false,
  });
  const result = assessAuditExecution(execution, { scope });
  if (result.errors.length > 0) {
    throw new Error(`Audit des dependances refuse:\n- ${result.errors.join('\n- ')}`);
  }

  console.log(`Audit des dependances: OK pour ${scope}; aucune vulnerabilite moderee, haute ou critique.`);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Audit des dependances impossible.');
    process.exitCode = 1;
  }
}
