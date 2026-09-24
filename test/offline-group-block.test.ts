// L72e (D7) — un rejeu hors ligne qui heurte R4 ou une occurrence supprimée devient un conflit
// structuré ; la saisie locale reste dans la file. Node + fake-indexeddb, sans PostgreSQL.
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildSnapshot, classifySyncError, enqueueEncounterUpdate, flushOutbox, offlineCache, outbox, setOfflineUser,
  type FlushDeps,
} from '../src/data/offline.js';
import {
  classifyIntakeSyncError, enqueueEncounterCreate, enqueuePatientCreate, flushIntake, intakeContextCache,
  intakeQueue, type IntakeEntry, type IntakeFlushDeps, type OfflineIntakeContext,
} from '../src/data/offlineIntake.js';

// Erreur telle que PostgREST la rend pour le refus R4 du serveur.
const blockHidden = () => Object.assign(new Error('GROUP_BLOCK_HIDDEN'), {
  code: 'P0001',
  details: JSON.stringify({ code: 'GROUP_BLOCK_HIDDEN', action: 'refresh_required', sectionKey: 'g1', blockKey: 'trauma' }),
  hint: 'refresh_required',
});

beforeAll(() => {
  vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  vi.stubEnv('VITE_OFFLINE_ADMIN_ACK', 'true');
  vi.stubEnv('VITE_OFFLINE_INTAKE', 'demo');
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => setOfflineUser('offline-l72e-user'));

describe('classification', () => {
  test('R4 est un conflit dans les deux files ; une occurrence disparue aussi', () => {
    expect(classifySyncError(blockHidden())).toBe('conflict');
    expect(classifyIntakeSyncError(blockHidden())).toBe('conflict');
    const notFound = new Error('RESOURCE_NOT_FOUND');
    expect(classifySyncError(notFound, 'g1')).toBe('conflict');
    // Une rencontre ordinaire introuvable reste un rejet, comme avant L72e.
    expect(classifySyncError(notFound, null)).toBe('rejected');
    expect(classifySyncError(notFound)).toBe('rejected');
  });
});

async function seedOccurrence(baseId: string): Promise<void> {
  const fields = [
    { id: 'f-g1', fieldKey: 'g1_niveau', label: 'Niveau', scope: 'encounter', type: 'text', displayOrder: 0, section: 'g1' },
  ];
  const sections = [
    { id: 's-trauma', sectionKey: 'trauma', label: 'Trauma', displayOrder: 0, parentSectionKey: null, isRepeatable: false },
    { id: 's-g1', sectionKey: 'g1', label: 'Lésions', displayOrder: 1, parentSectionKey: 'trauma', isRepeatable: true },
  ];
  await offlineCache.save(buildSnapshot(
    { id: baseId, name: baseId, templateVersionId: 'v1' },
    [{ id: 'p1', code: 'C1', templateVersionId: 'v1', data: {}, validationStatus: 'draft' }],
    { p1: [{ id: 'e1', encounterType: 'autre', encounterDate: null, validationStatus: 'draft', ageValue: null, ageUnit: null, data: { g1_niveau: 'C4' }, updatedAt: null, templateVersionId: 'v1', groupSectionKey: 'g1' }] },
    fields, Date.now(), { v1: fields }, undefined, sections, { v1: sections },
  ));
}

describe('correction d\'occurrence rejouée (preuve 6)', () => {
  for (const [label, failure] of [
    ['bloc devenu masqué', blockHidden],
    ['occurrence supprimée par un retrait', () => new Error('RESOURCE_NOT_FOUND')],
  ] as const) {
    test(`${label} : conflit, saisie locale préservée`, async () => {
      const baseId = `b-l72e-${label.length}`;
      await seedOccurrence(baseId);
      await enqueueEncounterUpdate({
        baseId, patientId: 'p1', encounterId: 'e1', data: { g1_niveau: 'C5' },
        reason: 'correction fictive', validationStatus: 'draft', baseUpdatedAt: null,
      });
      const deps: FlushDeps = {
        updateEncounter: async () => { throw failure(); },
        getEncounter: async () => null,
      };
      const report = await flushOutbox(deps, baseId);
      expect(report).toMatchObject({ synced: 0, conflicts: 1, failed: 0 });
      const [entry] = await outbox.list(baseId);
      expect(entry.state).toBe('conflict');
      expect(entry.data).toEqual({ g1_niveau: 'C5' });
      expect(entry.reason).toBe('correction fictive');
      await outbox.remove(entry.id);
      await offlineCache.remove(baseId);
    });
  }
});

describe('création d\'occurrence rejouée (preuve 6)', () => {
  test('bloc devenu masqué : conflit, charge conservée, le patient reste synchronisé', async () => {
    const context: OfflineIntakeContext = {
      dataType: 'intake_context', baseId: 'b-l72e-intake', baseName: 'Base fictive', templateVersionId: 'v1',
      observationModel: 'longitudinal', fields: [], rules: [],
      permissions: { canCreateStructuredData: true, canEditStructuredData: true, canViewIdentity: true },
      preparedAt: Date.now(), expiresAt: Date.now() + 3600_000,
    };
    await intakeContextCache.save(context);
    const patient = await enqueuePatientCreate({
      baseId: context.baseId, operationKey: 'op-l72e-p', payload: {
        code: 'H-L72E0001', fullName: 'Patient fictif', dateOfBirth: '1990-01-01', phone: null, address: null,
        externalIdentifier: null, permanentData: {},
      },
    });
    const payload = {
      encounterType: 'autre', encounterDate: null, validationStatus: 'draft', ageUnit: 'years',
      data: { g1_niveau: 'C5' },
    };
    const encounter = await enqueueEncounterCreate({
      baseId: context.baseId, operationKey: 'op-l72e-e', parentOperationKey: patient.id,
      payload: payload as unknown as Parameters<typeof enqueueEncounterCreate>[0]['payload'],
    });
    const deps: IntakeFlushDeps = {
      replayPatientCreate: async (input) => ({ id: 'srv-p', code: input.code }),
      replayEncounterCreate: async () => { throw blockHidden(); },
    };
    const report = await flushIntake(deps);
    expect(report.syncedPatients).toBe(1);
    expect(report.conflicts).toBe(1);
    const after = await intakeQueue.get(encounter.id) as Extract<IntakeEntry, { kind: 'encounter_create' }>;
    expect(after.state).toBe('conflict');
    expect(after.lastError).toMatch(/GROUP_BLOCK_HIDDEN/);
    expect(after.payload.data).toEqual({ g1_niveau: 'C5' });
  });
});
