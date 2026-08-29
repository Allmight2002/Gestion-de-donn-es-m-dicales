import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  assessAuditExecution,
  validateDependencyAudit,
} from '../scripts/validate-dependency-audit.mjs';

type AuditSeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

interface AuditReportFixture {
  auditReportVersion: number;
  vulnerabilities: Record<string, {
    name: string;
    severity: string;
    via: unknown[];
  }>;
  metadata: {
    vulnerabilities: Record<AuditSeverity | 'total', number>;
  };
}

const cleanReport = (): AuditReportFixture => ({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
  },
});

const reportWith = (severity: AuditSeverity): AuditReportFixture => {
  const report = cleanReport();
  report.vulnerabilities['unsafe-package'] = {
    name: 'unsafe-package',
    severity,
    via: [{ severity }],
  };
  report.metadata.vulnerabilities[severity] = 1;
  report.metadata.vulnerabilities.total = 1;
  return report;
};

describe('politique npm audit stricte', () => {
  test.each(['staging', 'production'] as const)('accepte un audit propre en scope %s', (scope) => {
    expect(validateDependencyAudit(cleanReport(), { scope })).toEqual({
      errors: [],
      acceptedAdvisories: [],
      scope,
    });
  });

  test.each([
    ['staging', 'moderate'],
    ['staging', 'high'],
    ['staging', 'critical'],
    ['production', 'moderate'],
    ['production', 'high'],
    ['production', 'critical'],
  ] as const)('refuse le scope %s pour une severite %s', (scope, severity) => {
    expect(validateDependencyAudit(reportWith(severity), { scope }).errors)
      .toContain(`unsafe-package conserve une vulnerabilite ${severity}.`);
  });

  test('conserve le seuil existant pour une severite basse', () => {
    expect(validateDependencyAudit(reportWith('low'), { scope: 'staging' }).errors).toEqual([]);
  });

  test('refuse des compteurs incoherents', () => {
    const report = cleanReport();
    report.metadata.vulnerabilities.total = 1;
    expect(validateDependencyAudit(report, { scope: 'staging' }).errors)
      .toContain('Le compteur npm total ne correspond pas aux entrees detaillees.');
  });

  test('echoue ferme si le rapport est mal forme ou npm audit indisponible', () => {
    expect(validateDependencyAudit({}, { scope: 'staging' }).errors)
      .toContain('Le rapport npm audit ne contient pas la liste des vulnerabilites.');
    expect(assessAuditExecution({ status: 1, stdout: 'pas du json' }).errors)
      .toEqual(['La sortie npm audit n est pas un JSON valide.']);
    expect(assessAuditExecution({ status: null, stdout: '', error: new Error('offline') }).errors)
      .toEqual(['Execution npm audit indisponible ou interrompue.']);
  });

  test('le cablage CI et release applique la meme politique stricte', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      engines: Record<string, string>;
      scripts: Record<string, string>;
      overrides: Record<string, string>;
    };
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const release = readFileSync('.github/workflows/coordinated-release.yml', 'utf8');
    const denoLock = readFileSync('deno.lock', 'utf8');

    expect(pkg.engines.node).toBe('>=22.22.0 <23');
    expect(pkg.dependencies.react).toBe('19.2.8');
    expect(pkg.dependencies['react-dom']).toBe('19.2.8');
    expect(pkg.dependencies['react-router']).toBe('8.3.0');
    expect(pkg.dependencies['react-router-dom']).toBeUndefined();
    expect(pkg.devDependencies['@testing-library/react']).toBe('16.3.2');
    expect(pkg.overrides).toEqual({ 'brace-expansion': '5.0.9', ejs: '6.0.1' });
    expect(pkg.scripts['audit:dependencies']).toBe('node scripts/validate-dependency-audit.mjs');
    expect(ci).toContain('npm run audit:dependencies -- --scope=staging');
    expect(release).toContain('npm run audit:dependencies -- --scope=staging');
    expect(release).toContain('npm run audit:dependencies -- --scope=production');
    expect(`${ci}\n${release}`).not.toContain('temporary staging policy');
    expect(denoLock).not.toContain('react-router-dom');
  });
});
