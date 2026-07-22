import { describe, expect, test } from 'vitest';
import { validateRecoveryEvidence } from '../scripts/validate-recovery-evidence.mjs';

const commit = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const now = new Date('2026-07-19T04:00:00.000Z');

const validEvidence = () => ({
  format: 'meddata-recovery-evidence/v1',
  environment: 'staging-isolated',
  dataClassification: 'fictitious-only',
  commit,
  observedAt: '2026-07-19T03:50:00.000Z',
  source: { backupSetSha256: hash, backupVerified: true, backupCommit: commit },
  isolation: {
    targetKind: 'ephemeral-local',
    productionConnected: false,
    targetWasEmpty: true,
    targetFingerprintSha256: hash,
  },
  timing: {
    startedAt: '2026-07-19T03:40:00.000Z',
    completedAt: '2026-07-19T03:49:00.000Z',
    observedRpoSeconds: 300,
    observedRtoSeconds: 540,
    approvedRpoSeconds: 900,
    approvedRtoSeconds: 1200,
    objectivesApprovalSha256: hash,
  },
  restore: {
    database: true,
    auth: true,
    storage: true,
    rlsEnabled: true,
    schemaMatches: true,
    foreignKeysChecked: 111,
    objectsExpected: 107,
    objectsRestored: 107,
    hashMismatches: 0,
    orphanCount: 0,
  },
  recovery: {
    frontendRollback: true,
    edgeRollback: true,
    storagePolicyReapply: true,
    forwardMigration: true,
  },
  journeys: {
    authentication: true,
    authorizationDenial: true,
    cleanUpload: true,
    eicarRejection: true,
    importRetry: true,
    scientificExport: true,
    auditTrail: true,
  },
  approvals: {
    releaseManager: { reference: 'CHANGE-2026-0042', evidenceSha256: hash },
    continuityOwner: { reference: 'BCP-2026-0007', evidenceSha256: hash },
  },
});

describe('preuve de restauration et reprise', () => {
  test('accepte une preuve complete, actuelle et rattachee au commit', () => {
    expect(validateRecoveryEvidence(validEvidence(), { expectedCommit: commit, now })).toEqual([]);
  });

  test('refuse une preuve checkbox sans objets, refus d acces ni approbation RPO/RTO', () => {
    const evidence = validEvidence();
    evidence.restore.objectsRestored = 106;
    evidence.restore.hashMismatches = 1;
    evidence.restore.orphanCount = 2;
    evidence.journeys.authorizationDenial = false;
    evidence.timing.observedRtoSeconds = 1300;
    evidence.timing.objectivesApprovalSha256 = 'placeholder';
    const errors = validateRecoveryEvidence(evidence, { expectedCommit: commit, now });
    expect(errors).toEqual(expect.arrayContaining([
      'Tous les objets attendus ne sont pas restaures.',
      'La restauration contient des divergences de hash.',
      'La restauration contient des orphelins referentiels.',
      'journeys.authorizationDenial doit etre vrai.',
      'Le RTO observe depasse le RTO approuve.',
      'La preuve d approbation RPO/RTO est absente.',
    ]));
  });

  test('refuse une cible production, une preuve perimee et un autre commit', () => {
    const evidence = validEvidence();
    evidence.isolation.productionConnected = true;
    evidence.observedAt = '2026-01-01T00:00:00.000Z';
    const errors = validateRecoveryEvidence(evidence, {
      expectedCommit: 'c'.repeat(40),
      now,
      maxAgeHours: 24,
    });
    expect(errors).toEqual(expect.arrayContaining([
      'La preuve ne correspond pas au commit attendu.',
      'La preuve de reprise est perimee.',
      'La cible doit etre vide et sans connexion production.',
    ]));
  });
});
