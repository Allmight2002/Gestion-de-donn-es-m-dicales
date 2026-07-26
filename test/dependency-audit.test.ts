import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  assessAuditExecution,
  STAGING_AUDIT_EXCEPTION_EXPIRES_AT,
  validateDependencyAudit,
} from '../scripts/validate-dependency-audit.mjs';

const advisory = (id: string, packageName: string) => ({
  source: 1,
  name: packageName,
  dependency: packageName,
  title: `Avis ${id}`,
  url: `https://github.com/advisories/${id}`,
  severity: 'moderate',
  range: '*',
});

interface AuditReportFixture {
  auditReportVersion: number;
  vulnerabilities: Record<string, {
    name: string;
    severity: string;
    via: Array<string | ReturnType<typeof advisory>>;
  }>;
  metadata: {
    vulnerabilities: Record<'info' | 'low' | 'moderate' | 'high' | 'critical' | 'total', number>;
  };
}

const validReport = (): AuditReportFixture => ({
  auditReportVersion: 2,
  vulnerabilities: {
    'react-router': {
      name: 'react-router',
      severity: 'moderate',
      via: [
        advisory('GHSA-wrjc-x8rr-h8h6', 'react-router'),
        advisory('GHSA-337j-9hxr-rhxg', 'react-router'),
      ],
    },
    'react-router-dom': {
      name: 'react-router-dom',
      severity: 'moderate',
      via: [advisory('GHSA-jjmj-jmhj-qwj2', 'react-router-dom'), 'react-router'],
    },
  },
  metadata: {
    vulnerabilities: { info: 0, low: 0, moderate: 2, high: 0, critical: 0, total: 2 },
  },
});

describe('exception npm audit staging', () => {
  test('accepte exactement les trois avis autorises avant expiration', () => {
    const result = validateDependencyAudit(validReport(), {
      scope: 'staging',
      now: new Date('2026-07-26T12:00:00.000Z'),
    });

    expect(result.errors).toEqual([]);
    expect(result.acceptedAdvisories).toEqual([
      'GHSA-337J-9HXR-RHXG',
      'GHSA-JJMJ-JMHJ-QWJ2',
      'GHSA-WRJC-X8RR-H8H6',
    ]);
  });

  test('refuse automatiquement l exception apres le 2 aout 2026', () => {
    const result = validateDependencyAudit(validReport(), {
      scope: 'staging',
      now: new Date('2026-08-03T00:00:00.000Z'),
    });

    expect(result.errors).toContain(
      `L exception staging a expire le ${STAGING_AUDIT_EXCEPTION_EXPIRES_AT}.`,
    );
  });

  test('refuse les memes avis en scope production', () => {
    const result = validateDependencyAudit(validReport(), { scope: 'production' });
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((error) => error.includes('interdite en production'))).toBe(true);
  });

  test('refuse tout avis modere supplementaire', () => {
    const report = validReport();
    report.vulnerabilities['unexpected-package'] = {
      name: 'unexpected-package',
      severity: 'moderate',
      via: [advisory('GHSA-AAAA-BBBB-CCCC', 'unexpected-package')],
    };
    report.metadata.vulnerabilities.moderate = 3;
    report.metadata.vulnerabilities.total = 3;

    expect(validateDependencyAudit(report, { scope: 'staging' }).errors)
      .toContain('Avis modere non autorise pour unexpected-package.');
  });

  test.each(['high', 'critical'] as const)('refuse une severite %s', (severity) => {
    const report = validReport();
    report.vulnerabilities['unsafe-package'] = {
      name: 'unsafe-package',
      severity,
      via: ['dependency'],
    };
    report.metadata.vulnerabilities[severity] = 1;
    report.metadata.vulnerabilities.total = 3;

    expect(validateDependencyAudit(report, { scope: 'staging' }).errors)
      .toContain(`unsafe-package conserve une vulnerabilite ${severity}.`);
  });

  test('echoue ferme si le rapport est mal forme ou npm audit indisponible', () => {
    expect(validateDependencyAudit({}, { scope: 'staging' }).errors)
      .toContain('Le rapport npm audit ne contient pas la liste des vulnerabilites.');
    expect(assessAuditExecution({ status: 1, stdout: 'pas du json' }).errors)
      .toEqual(['La sortie npm audit n est pas un JSON valide.']);
    expect(assessAuditExecution({ status: null, stdout: '', error: new Error('offline') }).errors)
      .toEqual(['Execution npm audit indisponible ou interrompue.']);
  });

  test('le cablage CI reste staging et le workflow production reste strict', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
      overrides: Record<string, string>;
    };
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const release = readFileSync('.github/workflows/coordinated-release.yml', 'utf8');

    expect(pkg.overrides).toEqual({ 'brace-expansion': '5.0.8', ejs: '6.0.1' });
    expect(pkg.scripts['audit:dependencies']).toBe('node scripts/validate-dependency-audit.mjs');
    expect(ci).toContain('npm run audit:dependencies -- --scope=staging');
    expect(release).toContain('npm run audit:dependencies -- --scope=staging');
    expect(release).toContain('npm run audit:dependencies -- --scope=production');
  });
});
