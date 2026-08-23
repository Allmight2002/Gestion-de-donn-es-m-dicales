// =============================================================================
// Tests du lot O2 de la feuille de route « saisie hors-ligne » : file locale des
// creations en attente (IndexedDB `outbox`, union discriminée), contexte de saisie,
// ordre des dependances, mapping local -> serveur, cascade et purge.
// Tourne en node avec fake-indexeddb, sans PostgreSQL (comme test/offline.test.ts).
// =============================================================================
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { INTAKE_CONTEXT_STORE, OUTBOX_STORE, idbTx, purgeExpiredOutbox, setOfflineUser } from '../src/data/offline.js';
import {
  canonicalJson, classifyIntakeSyncError, discardIntake, downloadIntakeContext,
  enqueueEncounterCreate, enqueuePatientCreate, flushIntake, intakeContextCache, intakeQueue,
  isLocalPatientId, offlinePatientCode, orderIntakeForSync, recoverAbandonedIntakes,
  retryIntake, sha256Hex,
  type IntakeEntry, type IntakeFlushDeps, type OfflineIntakeContext, type OutboxRecord,
} from '../src/data/offlineIntake.js';

const CTX: OfflineIntakeContext = {
  dataType: 'intake_context',
  baseId: 'b1',
  baseName: 'Base Test',
  templateVersionId: 'v1',
  observationModel: 'longitudinal',
  fields: [],
  rules: [],
  permissions: { canCreateStructuredData: true, canEditStructuredData: true, canViewIdentity: true },
  preparedAt: Date.now(),
  expiresAt: Date.now() + 3600_000,
};

const PATIENT_PAYLOAD = {
  code: 'H-TEST0001',
  fullName: 'Patient Fictif',
  dateOfBirth: '1990-01-01',
  phone: null,
  address: null,
  externalIdentifier: null,
  permanentData: { sexe: 'M' },
};

const ENCOUNTER_PAYLOAD = {
  encounterType: 'consultation',
  encounterDate: '2026-08-20',
  validationStatus: 'draft',
  ageUnit: 'years',
  data: {},
};

async function seedContext(over: Partial<OfflineIntakeContext> = {}): Promise<void> {
  await intakeContextCache.save({ ...CTX, ...over });
}

beforeAll(() => {
  vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  vi.stubEnv('VITE_OFFLINE_ADMIN_ACK', 'true');
  vi.stubEnv('VITE_OFFLINE_INTAKE', 'demo');
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(async () => {
  // Compte neuf + stores vides : chaque test part d'un appareil vierge.
  const all = await idbTx<OutboxRecord[]>(OUTBOX_STORE, 'readonly', (s) => s.getAll());
  for (const e of all) await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.delete(e.id));
  const contexts = await idbTx<{ key: string }[]>(INTAKE_CONTEXT_STORE, 'readonly', (s) => s.getAll());
  for (const c of contexts) await idbTx(INTAKE_CONTEXT_STORE, 'readwrite', (s) => s.delete(c.key));
});

describe('contrat des operations (O0)', () => {
  test('canonicalJson est insensible a l ordre des cles', () => {
    expect(canonicalJson({ b: 1, a: [2, { z: null, y: 1 }] }))
      .toBe(canonicalJson({ a: [2, { y: 1, z: null }], b: 1 }));
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });

  test('sha256Hex produit une empreinte hexadecimale deterministe', async () => {
    const h = await sha256Hex('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(await sha256Hex('abc'));
    expect(h).not.toBe(await sha256Hex('abd'));
  });

  test('offlinePatientCode est stable, derive de l operation et improbable a collision', async () => {
    const code = await offlinePatientCode('op-key-123');
    expect(code).toMatch(/^H-[0-9A-F]{8}$/);
    expect(code).toBe(await offlinePatientCode('op-key-123'));
    expect(code).not.toBe(await offlinePatientCode('op-key-124'));
  });

  test('classification des erreurs de synchronisation (feuille de route O5)', () => {
    // Permission RETIREE entre la saisie et la synchro : rejet DEFINITIF, visible.
    expect(classifyIntakeSyncError({ status: 403 })).toBe('rejected');
    expect(classifyIntakeSyncError({ message: 'permission denied for table patient' })).toBe('rejected');
    expect(classifyIntakeSyncError(new Error('Acces refuse'))).toBe('rejected');
    // Doublons explicites : jamais silencieux.
    expect(classifyIntakeSyncError({ code: '23505', message: 'duplicate key value violates unique constraint "uq_identity_base_code"' })).toBe('rejected');
    expect(classifyIntakeSyncError(new Error('OFFLINE_IDENTITY_DUPLICATE'))).toBe('rejected');
    // Rejeu incoherent : refuse.
    expect(classifyIntakeSyncError(new Error('OFFLINE_OPERATION_MISMATCH'))).toBe('rejected');
    // Parent pas encore confirme : transitoire (la dependance sera rejouee apres lui).
    expect(classifyIntakeSyncError(new Error('OFFLINE_PARENT_NOT_SYNCED'))).toBe('transient');
    // Reseau coupe : transitoire (rejouable sans doublon grace a la cle).
    expect(classifyIntakeSyncError(new Error('ERR_NETWORK'))).toBe('transient');
  });
});

describe('preparation du contexte de saisie (en ligne)', () => {
  const baseSource = () => ({
    getBase: async () => ({
      base: { id: 'b1', name: 'Base Test', currentTemplateVersionId: 'v1', observationModel: 'longitudinal' },
      role: 'member',
      permissions: { canViewIdentity: true, canEditStructuredData: false },
      canCreateStructuredData: true,
    }),
    getVersion: async () => ({
      fields: [{
        id: 'f1', fieldKey: 'sexe', label: 'Sexe', scope: 'patient' as const, type: 'select' as const,
        section: 'clinique', unit: null, allowedValues: ['M', 'F'], allowedOptions: null,
        required: true, minValue: null, maxValue: null, allowMissingCodes: false, displayOrder: 1,
      }],
      rules: [],
    }),
  });

  test('le contexte ne transporte que des METADONNEES et resout les droits du compte', async () => {
    setOfflineUser('user-a');
    const meta = await downloadIntakeContext('b1', baseSource());
    expect(meta.baseId).toBe('b1');

    const ctx = await intakeContextCache.get('b1');
    expect(ctx?.permissions).toEqual({
      canCreateStructuredData: true, canEditStructuredData: false, canViewIdentity: true,
    });
    // Aucune ligne patient : le contexte n'est pas un instantane de lecture.
    expect(JSON.stringify(ctx)).not.toContain('"patients"');
  });  test('un acces a echeance (mission) ne prepare PAS de contexte', async () => {
    setOfflineUser('user-a');
    const src = { ...baseSource(), getBase: async () => ({
      ...(await baseSource().getBase())!,
      expiresAt: '2026-09-01T00:00:00Z',
    }) };
    await expect(downloadIntakeContext('b1', src)).rejects.toThrow(/OFFLINE_INTAKE_MISSION_UNSUPPORTED/);
  });

  test('sans gabarit courant : refus explicite', async () => {
    setOfflineUser('user-a');
    const src = { ...baseSource(), getBase: async () => ({
      base: { id: 'b1', name: 'Base Test', currentTemplateVersionId: null },
      role: 'owner',
      permissions: { canViewIdentity: true, canEditStructuredData: true },
    }) };
    await expect(downloadIntakeContext('b1', src)).rejects.toThrow(/gabarit courant/);
  });
});

describe('mise en file (O2)', () => {
  test('sans compte ni contexte prepare : refus explicite, rien n est persiste', async () => {
    setOfflineUser(null);
    await expect(enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-guard', payload: PATIENT_PAYLOAD }))
      .rejects.toThrow(/Aucun compte actif/);

    setOfflineUser('user-a');
    await expect(enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-guard', payload: PATIENT_PAYLOAD }))
      .rejects.toThrow(/OFFLINE_INTAKE_CONTEXT_REQUIRED/);
    expect(await intakeQueue.list()).toHaveLength(0);
  });

  test('un patient en attente porte identite LOCALE, charge complete et empreinte', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const entry = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-local', payload: PATIENT_PAYLOAD });

    expect(entry.id).toBe('op-local'); // la cle vient de l'ECRAN
    expect(isLocalPatientId(entry.localPatientId)).toBe(true);
    expect(entry.state).toBe('pending');
    expect(entry.payload.fullName).toBe('Patient Fictif'); // identite cloisonnee dans la file
    expect(entry.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.ownerUserId).toBe('user-a');

    const stored = await intakeQueue.get(entry.id);
    expect(stored?.kind).toBe('patient_create'); // survit a la relecture (= rechargement)
  });

  test('une MEME cle rejouee : no-op si charge identique, REFUS si charge differente', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const first = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-immutable', payload: PATIENT_PAYLOAD });

    // Double clic / nouvelle soumission de la meme intention : l'entree existante fait foi.
    const again = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-immutable', payload: PATIENT_PAYLOAD });
    expect(again.localPatientId).toBe(first.localPatientId);
    expect(await intakeQueue.list()).toHaveLength(1);

    // Modifier la charge sous la meme cle est refuse (invariant §3.3).
    await expect(enqueuePatientCreate({
      baseId: 'b1', operationKey: 'op-immutable', payload: { ...PATIENT_PAYLOAD, fullName: 'Autre Nom' },
    })).rejects.toThrow(/OFFLINE_OPERATION_MISMATCH/);
    expect((await intakeQueue.get('op-immutable'))?.payload).toMatchObject({ fullName: 'Patient Fictif' });
  });

  test('une rencontre dependante exige un parent existant et recuperable', async () => {
    setOfflineUser('user-a');
    await seedContext();

    await expect(enqueueEncounterCreate({
      baseId: 'b1', operationKey: 'op-orphan', parentOperationKey: 'inconnu', payload: ENCOUNTER_PAYLOAD,
    })).rejects.toThrow(/OFFLINE_INTAKE_PARENT_INVALID/);

    const patient = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-dep-pat', payload: PATIENT_PAYLOAD });
    const enc = await enqueueEncounterCreate({
      baseId: 'b1', operationKey: 'op-dep-enc', parentOperationKey: patient.id, payload: ENCOUNTER_PAYLOAD,
    });
    expect(enc.parentOperationKey).toBe(patient.id);
    expect(enc.localEncounterId).not.toBe(patient.localPatientId); // identifiants locaux distincts
  });

  test('l isolation par compte empeche de voir ou rejouer les saisies d un autre', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const entry = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-iso', payload: PATIENT_PAYLOAD });

    setOfflineUser('user-b');
    expect(await intakeQueue.list()).toHaveLength(0);
    expect(await intakeQueue.get(entry.id)).toBeNull(); // §5.5 : aucune voie inter-comptes

    // user-b doit preparer SON propre contexte pour saisir sur la meme base.
    await expect(enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-iso-b', payload: PATIENT_PAYLOAD }))
      .rejects.toThrow(/OFFLINE_INTAKE_CONTEXT_REQUIRED/);
  });
});

describe('synchronisation ordonnee (O4)', () => {
  test('le patient part AVANT ses rencontres ; le mapping serveur est enregistre', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const patient = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-sync-p1', payload: PATIENT_PAYLOAD });
    const enc = await enqueueEncounterCreate({
      baseId: 'b1', operationKey: 'op-sync-e1', parentOperationKey: patient.id, payload: ENCOUNTER_PAYLOAD,
    });

    const calls: string[] = [];
    const deps: IntakeFlushDeps = {
      replayPatientCreate: async (input) => {
        calls.push(`patient:${input.operationKey}`);
        return { id: 'srv-p-1', code: input.code };
      },
      replayEncounterCreate: async (input) => {
        calls.push(`encounter:${input.operationKey}`);
        return { id: 'srv-e-1', patientId: 'srv-p-1' };
      },
    };
    const rep = await flushIntake(deps);
    expect(calls).toEqual([`patient:${patient.id}`, `encounter:${enc.id}`]); // dependance ordonnee
    expect(rep.syncedPatients).toBe(1);
    expect(rep.syncedEncounters).toBe(1);

    const pAfter = await intakeQueue.get(patient.id) as Extract<IntakeEntry, { kind: 'patient_create' }>;
    expect(pAfter.serverPatientId).toBe('srv-p-1');
    expect(pAfter.serverCode).toBe(PATIENT_PAYLOAD.code);
    const eAfter = await intakeQueue.get(enc.id) as Extract<IntakeEntry, { kind: 'encounter_create' }>;
    expect(eAfter.serverEncounterId).toBe('srv-e-1');
    expect(eAfter.serverPatientId).toBe('srv-p-1');
  });

  test('une erreur TRANSITOIRE conserve la cle et la charge : rejeu idempotent possible', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const patient = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-retry', payload: PATIENT_PAYLOAD });

    let attempts = 0;
    const deps: IntakeFlushDeps = {
      replayPatientCreate: async (input) => {
        attempts += 1;
        if (attempts === 1) throw new Error('ERR_NETWORK'); // reponse jamais obtenue
        return { id: 'srv-p-9', code: input.code };
      },
      replayEncounterCreate: async () => ({ id: 'x', patientId: 'y' }),
    };
    const first = await flushIntake(deps);
    expect(first.failed).toBe(1);
    const afterFail = await intakeQueue.get(patient.id);
    expect(afterFail?.state).toBe('pending');

    const second = await flushIntake(deps);
    expect(second.syncedPatients).toBe(1);
    expect(attempts).toBe(2);
    const final = await intakeQueue.get(patient.id) as Extract<IntakeEntry, { kind: 'patient_create' }>;
    expect(final.serverPatientId).toBe('srv-p-9');
  });

  test('retryIntake rend une operation rejetee a nouveau eligible ; bloque reste bloque', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const patient = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-rejected', payload: PATIENT_PAYLOAD });
    await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.put({
      ...patient, state: 'rejected', lastError: 'OFFLINE_IDENTITY_DUPLICATE',
    }));
    await retryIntake(patient.id);
    expect((await intakeQueue.get(patient.id))?.state).toBe('pending');

    await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.put({ ...patient, state: 'blocked' }));
    await retryIntake(patient.id);
    expect((await intakeQueue.get(patient.id))?.state).toBe('blocked');
  });

  test('un rejet DEFINITIF bloque les rencontres dependantes : jamais synchronisees en aveugle', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const patient = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-blocked-p', payload: PATIENT_PAYLOAD });
    await enqueueEncounterCreate({
      baseId: 'b1', operationKey: 'op-blocked-e', parentOperationKey: patient.id, payload: ENCOUNTER_PAYLOAD,
    });

    let encounterCalled = false;
    const rep = await flushIntake({
      replayPatientCreate: async () => { throw new Error('OFFLINE_IDENTITY_DUPLICATE'); },
      replayEncounterCreate: async () => { encounterCalled = true; return { id: 'x', patientId: 'y' }; },
    });
    expect(rep.failed).toBe(1); // seul le patient echoue
    expect(rep.blocked).toBe(1); // la dependance est marquee visible
    expect(encounterCalled).toBe(false); // la rencontre ne part PAS

    const encEntry = (await intakeQueue.visible()).find(
      (e): e is Extract<IntakeEntry, { kind: 'encounter_create' }> => e.kind === 'encounter_create',
    );
    expect(encEntry?.state).toBe('blocked');
  });

  test('une charge modifiee localement est refusee SANS appel reseau', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const patient = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-mutate', payload: PATIENT_PAYLOAD });

    // Mutation frauduleuse/accidentelle de la charge apres coup.
    const raw = await idbTx<OutboxRecord>(OUTBOX_STORE, 'readonly', (s) => s.get(patient.id));
    await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.put({
      ...(raw as object),
      payload: { ...PATIENT_PAYLOAD, fullName: 'Nom Modifie' },
    }));

    let called = false;
    const rep = await flushIntake({
      replayPatientCreate: async () => { called = true; return { id: 'x', code: 'y' }; },
      replayEncounterCreate: async () => ({ id: 'x', patientId: 'y' }),
    });
    expect(called).toBe(false);
    expect(rep.failed).toBe(1);
    const after = await intakeQueue.get(patient.id);
    expect(after?.state).toBe('rejected');
    expect(after?.lastError).toBe('OFFLINE_OPERATION_MISMATCH');
  });

  test('un lease syncing orphelin est repris au prochain passage (crash/reprise)', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const patient = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-lease', payload: PATIENT_PAYLOAD });
    await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.put({ ...patient, state: 'syncing' }));

    expect(await recoverAbandonedIntakes()).toBe(1);
    expect((await intakeQueue.get(patient.id))?.state).toBe('pending');
  });

  test('orderIntakeForSync place toujours les patients avant leurs rencontres', () => {
    const mkPatient = (id: string, createdAt: number) =>
      ({ dataType: 'intake_outbox', kind: 'patient_create', id, baseId: 'b1', state: 'pending', fingerprint: 'f', createdAt, expiresAt: 1, localPatientId: `lp-${id}`, payload: PATIENT_PAYLOAD }) as IntakeEntry;
    const mkEnc = (id: string, createdAt: number) =>
      ({ dataType: 'intake_outbox', kind: 'encounter_create', id, baseId: 'b1', state: 'pending', fingerprint: 'f', createdAt, expiresAt: 1, localEncounterId: `le-${id}`, parentOperationKey: 'p1', payload: ENCOUNTER_PAYLOAD }) as IntakeEntry;
    const ordered = orderIntakeForSync([mkEnc('e1', 1), mkPatient('p2', 2), mkEnc('e2', 3), mkPatient('p1', 4)]);
    expect(ordered.map((e) => `${e.kind}:${e.id}`)).toEqual([
      'patient_create:p2', 'patient_create:p1', 'encounter_create:e1', 'encounter_create:e2',
    ]);
  });
});

describe('cascade, abandon et purge (O2)', () => {
  test('supprimer un patient en attente supprime ses rencontres dependantes', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const patient = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-cascade', payload: PATIENT_PAYLOAD });
    await enqueueEncounterCreate({ baseId: 'b1', operationKey: 'op-cascade-e1', parentOperationKey: patient.id, payload: ENCOUNTER_PAYLOAD });
    await enqueueEncounterCreate({ baseId: 'b1', operationKey: 'op-cascade-e2', parentOperationKey: patient.id, payload: ENCOUNTER_PAYLOAD });

    expect(await discardIntake(patient.id)).toBe(3);
    expect(await intakeQueue.list()).toHaveLength(0);
  });

  test('purge : expirees supprimees, traces de reussite conservees jusqu a leur expiration', async () => {
    setOfflineUser('user-a');
    await seedContext();
    const succeeded = await enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-succeeded', payload: PATIENT_PAYLOAD });
    const expired = await enqueuePatientCreate({
      baseId: 'b1', operationKey: 'op-expired', payload: { ...PATIENT_PAYLOAD, code: 'H-EXPIRE01' },
    });

    await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.put({ ...succeeded, state: 'succeeded' }));
    await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.put({ ...expired, expiresAt: Date.now() - 1 }));

    expect(await purgeExpiredOutbox()).toBe(1);
    const left = await intakeQueue.list();
    expect(left.map((e) => e.id)).toEqual([succeeded.id]);
    expect(left[0].state).toBe('succeeded');

    // Une fois la trace elle-meme expiree, le menage la retire.
    await idbTx(OUTBOX_STORE, 'readwrite', (s) => s.put({ ...succeeded, expiresAt: Date.now() - 1 }));
    expect(await purgeExpiredOutbox()).toBe(1);
    expect(await intakeQueue.list()).toHaveLength(0);
  });

  test('contexte expire : la creation hors-ligne est refusee (invariant §3.12)', async () => {
    setOfflineUser('user-a');
    await seedContext({ expiresAt: Date.now() - 1 });
    expect(await intakeContextCache.get('b1')).toBeNull();
    await expect(enqueuePatientCreate({ baseId: 'b1', operationKey: 'op-stale', payload: PATIENT_PAYLOAD }))
      .rejects.toThrow(/OFFLINE_INTAKE_CONTEXT_REQUIRED/);
  });
});
