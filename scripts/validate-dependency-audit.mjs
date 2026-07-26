import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Fin du 2 aout dans le fuseau du projet (Africa/Douala, UTC+1).
export const STAGING_AUDIT_EXCEPTION_EXPIRES_AT = '2026-08-02T22:59:59.000Z';

export const STAGING_AUDIT_ALLOWLIST = Object.freeze({
  'GHSA-WRJC-X8RR-H8H6': Object.freeze({ packageName: 'react-router', severity: 'moderate' }),
  'GHSA-337J-9HXR-RHXG': Object.freeze({ packageName: 'react-router', severity: 'moderate' }),
  'GHSA-JJMJ-JMHJ-QWJ2': Object.freeze({ packageName: 'react-router-dom', severity: 'moderate' }),
});

const TRACKED_SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const GHSA_URL = /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/i;

const clean = (value) => typeof value === 'string' ? value.trim() : '';

function advisoryId(advisory) {
  const match = clean(advisory?.url).match(GHSA_URL);
  return match?.[1]?.toUpperCase() ?? '';
}

function terminalAdvisories(packageName, vulnerabilities, path, errors) {
  if (path.has(packageName)) {
    errors.push(`Cycle inattendu dans la chaine d avis npm pour ${packageName}.`);
    return [];
  }

  const vulnerability = vulnerabilities[packageName];
  if (!vulnerability || typeof vulnerability !== 'object' || Array.isArray(vulnerability)) {
    errors.push(`Reference npm introuvable pour ${packageName}.`);
    return [];
  }
  if (!Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
    errors.push(`Aucun avis terminal verifiable pour ${packageName}.`);
    return [];
  }

  const nextPath = new Set(path).add(packageName);
  return vulnerability.via.flatMap((via) => {
    if (typeof via === 'string') {
      return terminalAdvisories(via, vulnerabilities, nextPath, errors);
    }
    if (!via || typeof via !== 'object' || Array.isArray(via)) {
      errors.push(`Avis npm mal forme pour ${packageName}.`);
      return [];
    }
    return [{ packageName, advisory: via }];
  });
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function validateDependencyAudit(report, {
  scope = 'staging',
  now = new Date(),
} = {}) {
  const errors = [];
  const accepted = new Set();

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

    if (severity === 'critical' || severity === 'high') {
      errors.push(`${packageName} conserve une vulnerabilite ${severity}.`);
      continue;
    }
    if (severity !== 'moderate') continue;

    if (scope === 'production') {
      errors.push(`${packageName} conserve une vulnerabilite moderee interdite en production.`);
      continue;
    }

    const terminals = terminalAdvisories(packageName, vulnerabilities, new Set(), errors);
    for (const terminal of terminals) {
      const id = advisoryId(terminal.advisory);
      const allowed = STAGING_AUDIT_ALLOWLIST[id];
      if (!id || !allowed) {
        errors.push(`Avis modere non autorise pour ${terminal.packageName}.`);
        continue;
      }

      const advisoryPackage = clean(terminal.advisory.name || terminal.advisory.dependency);
      const advisoryDependency = clean(terminal.advisory.dependency || terminal.advisory.name);
      const advisorySeverity = clean(terminal.advisory.severity).toLowerCase();
      if (advisoryPackage !== allowed.packageName
          || advisoryDependency !== allowed.packageName
          || advisorySeverity !== allowed.severity) {
        errors.push(`L avis ${id} ne correspond pas au paquet et a la severite autorises.`);
        continue;
      }
      accepted.add(id);
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

  if (accepted.size > 0) {
    const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
    const expiryMs = Date.parse(STAGING_AUDIT_EXCEPTION_EXPIRES_AT);
    if (!Number.isFinite(nowMs)) {
      errors.push('La date de controle de l exception est invalide.');
    } else if (nowMs > expiryMs) {
      errors.push(`L exception staging a expire le ${STAGING_AUDIT_EXCEPTION_EXPIRES_AT}.`);
    }
  }

  return {
    errors: [...new Set(errors)],
    acceptedAdvisories: [...accepted].sort(),
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

  if (result.acceptedAdvisories.length > 0) {
    console.log(
      `Audit des dependances: OK pour staging uniquement; ${result.acceptedAdvisories.length} avis moderes autorises jusqu au ${STAGING_AUDIT_EXCEPTION_EXPIRES_AT}.`,
    );
  } else {
    console.log(`Audit des dependances: OK pour ${scope}; aucune exception utilisee.`);
  }
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
