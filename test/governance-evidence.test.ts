import { describe, expect, test } from 'vitest';
import { validateGovernanceEvidence } from '../scripts/validate-governance-evidence.mjs';

const commit = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const signedAt = '2026-07-17T10:00:00.000Z';
const approval = (reference: string) => ({
  decision: 'approved', reference, evidenceSha256: hash, signedAt,
});
const contract = (reference: string) => ({ status: 'signed', reference, evidenceSha256: hash });

const validEvidence = () => ({
  format: 'meddata-governance-evidence/v1',
  environment: 'production',
  country: 'tchad',
  usageScope: 'production-complete',
  commit,
  issuedAt: '2026-07-18T10:00:00.000Z',
  expiresAt: '2027-01-18T10:00:00.000Z',
  approvals: {
    dataController: approval('DECISION-RT-001'),
    legalCounsel: approval('AVIS-JUR-001'),
    dataProtectionAuthority: approval('ANSICE-001'),
    clinicalAuthority: approval('CLINIQUE-001'),
    scientificAuthority: approval('SCIENCE-001'),
    ethicsAuthority: approval('ETHIQUE-001'),
    operationsAuthority: approval('OPS-001'),
    securityAuthority: approval('RSSI-001'),
  },
  contracts: {
    supabase: contract('DPA-SUPABASE-001'),
    vercel: contract('DPA-VERCEL-001'),
    antivirusOperator: contract('DPA-AV-001'),
    emailProvider: contract('DPA-SMTP-001'),
  },
  controls: {
    dpiaEvidenceSha256: hash,
    dataResidencyEvidenceSha256: hash,
    incidentProcedureEvidenceSha256: hash,
    riskDecisionEvidenceSha256: hash,
    residualRiskDecision: 'accepted-low-only',
  },
});

describe('preuve de gouvernance production', () => {
  test('accepte uniquement les decisions signees et liees au SHA', () => {
    expect(validateGovernanceEvidence(validEvidence(), {
      expectedCommit: commit,
      now: new Date('2026-07-19T00:00:00.000Z'),
    })).toEqual([]);
  });

  test('refuse les projets, placeholders, contrats absents et risque eleve accepte', () => {
    const evidence = validEvidence();
    evidence.approvals.ethicsAuthority = approval('PROJET - TODO');
    evidence.contracts.supabase.status = 'pending';
    evidence.controls.residualRiskDecision = 'accepted-high';
    const errors = validateGovernanceEvidence(evidence, {
      expectedCommit: commit,
      now: new Date('2026-07-19T00:00:00.000Z'),
    });
    expect(errors).toEqual(expect.arrayContaining([
      'approvals.ethicsAuthority.reference est absente ou provisoire.',
      'contracts.supabase.status doit valoir signed.',
      'controls.residualRiskDecision doit valoir accepted-low-only.',
    ]));
  });

  test('refuse un autre commit et une preuve expiree', () => {
    const errors = validateGovernanceEvidence(validEvidence(), {
      expectedCommit: 'c'.repeat(40),
      now: new Date('2027-02-01T00:00:00.000Z'),
    });
    expect(errors).toEqual(expect.arrayContaining([
      'Le manifeste ne correspond pas au commit promu.',
      'Le manifeste est expire ou sans expiration valide.',
    ]));
  });
});
