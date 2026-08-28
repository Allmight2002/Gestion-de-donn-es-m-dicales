import { describe, expect, test } from 'vitest';
import { validateOperationsEvidence } from '../scripts/validate-operations-evidence.mjs';

const commit = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const role = (id: string) => ({
  primaryAssignmentReference: `PRIMARY-${id}-001`,
  alternateAssignmentReference: `ALTERNATE-${id}-001`,
  assignmentEvidenceSha256: hash,
  trainingEvidenceSha256: hash,
  runbookAcceptanceSha256: hash,
});

const validEvidence = () => ({
  format: 'meddata-operations-evidence/v1',
  environment: 'production',
  commit,
  issuedAt: '2026-07-21T10:00:00.000Z',
  expiresAt: '2026-09-21T10:00:00.000Z',
  roles: Object.fromEntries([
    'releaseManager', 'databaseOwner', 'securityLead', 'dataProtectionLead',
    'clinicalQaLead', 'scientificQaLead', 'supportOwner', 'incidentCommander',
  ].map((id) => [id, role(id)])),
  onCall: {
    coverage: '24x7',
    scheduleReference: 'ONCALL-SCHEDULE-001',
    contactDirectoryReference: 'CONTACT-DIRECTORY-001',
    notificationAuthorityReference: 'NOTIFICATION-AUTHORITY-001',
    criticalAckMinutes: 10,
    criticalEscalationMinutes: 20,
    lastDrillAt: '2026-07-20T10:00:00.000Z',
    drillEvidenceSha256: hash,
    drillResult: 'passed',
  },
  support: {
    ticketingReference: 'TICKETING-001',
    capacityPlanReference: 'CAPACITY-PLAN-001',
    serviceLevelReference: 'SERVICE-LEVEL-001',
    capacityEvidenceSha256: hash,
    serviceLevelEvidenceSha256: hash,
    escalationEvidenceSha256: hash,
    concurrentCriticalCapacity: 2,
  },
  qa: {
    result: 'passed',
    criticalFindingsOpen: 0,
    highFindingsOpen: 0,
    clinicalSessionAt: '2026-07-20T08:00:00.000Z',
    scientificReviewAt: '2026-07-20T09:00:00.000Z',
    clinicalSessionEvidenceSha256: hash,
    scientificReviewEvidenceSha256: hash,
    protocolSha256: hash,
  },
  access: {
    mfaReviewAt: '2026-07-19T10:00:00.000Z',
    leastPrivilegeReviewAt: '2026-07-19T11:00:00.000Z',
    mfaEvidenceSha256: hash,
    leastPrivilegeEvidenceSha256: hash,
    privilegedAccountsReviewed: 4,
    stalePrivilegedAccounts: 0,
    accountsWithoutMfa: 0,
  },
  runbooks: Object.fromEntries([
    'incident', 'monitoring', 'backup', 'restore', 'rollback', 'release',
  ].map((id) => [`${id}Sha256`, hash])),
});

describe('preuve operationnelle production', () => {
  test('accepte des responsabilites doubles, une astreinte exercee et une QA sans ecart ouvert', () => {
    expect(validateOperationsEvidence(validEvidence(), {
      expectedCommit: commit,
      now: new Date('2026-07-22T00:00:00.000Z'),
    })).toEqual([]);
  });

  test('refuse les affectations provisoires et une suppleance identique', () => {
    const evidence = validEvidence();
    evidence.roles.databaseOwner.alternateAssignmentReference = evidence.roles.databaseOwner.primaryAssignmentReference;
    evidence.roles.securityLead.primaryAssignmentReference = 'TODO - projet';
    const errors = validateOperationsEvidence(evidence, {
      expectedCommit: commit,
      now: new Date('2026-07-22T00:00:00.000Z'),
    });
    expect(errors).toEqual(expect.arrayContaining([
      'roles.databaseOwner: titulaire et suppleant doivent etre distincts.',
      'roles.securityLead.primaryAssignmentReference est absente ou provisoire.',
    ]));
  });

  test('refuse une astreinte non permanente, une simulation perimee et des ecarts QA', () => {
    const evidence = validEvidence();
    evidence.onCall.coverage = 'business-hours';
    evidence.onCall.lastDrillAt = '2025-01-01T00:00:00.000Z';
    evidence.qa.highFindingsOpen = 1;
    evidence.access.accountsWithoutMfa = 1;
    const errors = validateOperationsEvidence(evidence, {
      expectedCommit: commit,
      now: new Date('2026-07-22T00:00:00.000Z'),
    });
    expect(errors).toEqual(expect.arrayContaining([
      'onCall.coverage doit valoir 24x7.',
      'onCall.lastDrillAt est absent ou date de plus de 93 jours.',
      'qa.highFindingsOpen doit valoir 0.',
      'access.accountsWithoutMfa doit valoir 0.',
    ]));
  });

  test('refuse un autre commit, une preuve expiree ou valable plus de 90 jours', () => {
    const evidence = validEvidence();
    evidence.expiresAt = '2027-07-21T10:00:00.000Z';
    const errors = validateOperationsEvidence(evidence, {
      expectedCommit: 'c'.repeat(40),
      now: new Date('2027-08-01T00:00:00.000Z'),
    });
    expect(errors).toEqual(expect.arrayContaining([
      'Le manifeste operationnel ne correspond pas au commit promu.',
      'Le manifeste operationnel est expire ou sans expiration valide.',
      'La validite du manifeste operationnel depasse 90 jours.',
    ]));
  });
});
