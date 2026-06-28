// Tests du cache HORS-LIGNE (Phase 1) : garantie "analytique seulement" (aucune identite) +
// stockage IndexedDB (via fake-indexeddb). Tourne en node, sans PostgreSQL.
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import {
  buildSnapshot, downloadBaseSnapshot, enqueueEncounterUpdate, flushOutbox, isExpired,
  offlineCache, OFFLINE_TTL_MS, outbox, resolveKeepMine, resolveKeepServer,
  type FlushDeps, type SnapshotSource,
} from '../src/data/offline.js';

// Petit utilitaire : amorce un cache avec 1 patient + 1 rencontre (analytique).
async function seedBase(baseId: string, encUpdatedAt: string) {
  await offlineCache.save(
    buildSnapshot(
      { id: baseId, name: baseId, templateVersionId: 'v1' },
      [{ id: 'p1', code: 'C1', templateVersionId: 'v1', data: {}, validationStatus: 'curated' }],
      { p1: [{ id: 'e1', encounterType: 'consultation', encounterDate: '2024-01-01', validationStatus: 'curated', ageValue: 40, ageUnit: 'years', data: { glasgow_score: 10 }, updatedAt: encUpdatedAt }] },
      [],
      Date.now(),
    ),
  );
}
const cachedEnc = async (baseId: string) => (await offlineCache.get(baseId))!.patients[0].encounters[0];

describe('buildSnapshot — analytique seulement (securite)', () => {
  test('ne recopie JAMAIS l identite, meme si le patient en entree en contient', () => {
    // patient COMPLET (avec identite) tel que renvoye par le repo en ligne.
    const patient = {
      id: 'p1', code: 'NCH-001', templateVersionId: 'v1', data: { sexe: 'M', birth_year: 1980 },
      validationStatus: 'curated', identity: { fullName: 'Jean Secret', dateOfBirth: '1980-01-01' },
    };
    const snap = buildSnapshot(
      { id: 'b1', name: 'Base', templateVersionId: 'v1' },
      [patient],
      { p1: [{ id: 'e1', encounterType: 'consultation', encounterDate: '2024-01-05', validationStatus: 'curated', ageValue: 44, ageUnit: 'years', data: { glasgow_score: 12 } }] },
      [],
      1000,
    );
    expect(snap.patients[0]).not.toHaveProperty('identity');
    expect(JSON.stringify(snap)).not.toContain('Secret'); // aucune trace de l'identite
    expect(JSON.stringify(snap)).not.toContain('1980-01-01');
    expect(snap.patients[0].data).toEqual({ sexe: 'M', birth_year: 1980 }); // analytique conserve
    expect(snap.patients[0].encounters[0].data).toEqual({ glasgow_score: 12 });
    expect(snap.expiresAt).toBe(1000 + OFFLINE_TTL_MS);
  });
});

describe('isExpired', () => {
  test('vrai uniquement apres expiresAt', () => {
    expect(isExpired({ expiresAt: 100 }, 50)).toBe(false);
    expect(isExpired({ expiresAt: 100 }, 200)).toBe(true);
  });
});

describe('offlineCache (IndexedDB)', () => {
  test('save / get / list (meta) / remove', async () => {
    const snap = buildSnapshot(
      { id: 'bX', name: 'Ma base', templateVersionId: 'v1' },
      [{ id: 'p1', code: 'C1', templateVersionId: 'v1', data: {}, validationStatus: 'draft' }],
      {},
      [],
      Date.now(),
    );
    await offlineCache.save(snap);

    const got = await offlineCache.get('bX');
    expect(got?.baseName).toBe('Ma base');
    expect(got?.patients).toHaveLength(1);

    const metas = await offlineCache.list();
    expect(metas.find((m) => m.baseId === 'bX')).toMatchObject({ baseName: 'Ma base', patientCount: 1 });

    await offlineCache.remove('bX');
    expect(await offlineCache.get('bX')).toBeNull();
  });
});

describe('downloadBaseSnapshot', () => {
  test('agrege base + patients + rencontres + champs et persiste un instantane analytique', async () => {
    const src: SnapshotSource = {
      getBase: async () => ({ base: { id: 'bD', name: 'Base D', currentTemplateVersionId: 'v9' } }),
      // le repo en ligne renvoie l'identite -> elle NE DOIT PAS finir dans le cache.
      listPatients: async () => [
        { id: 'p1', code: 'D-001', templateVersionId: 'v9', data: { sexe: 'F' }, validationStatus: 'curated', identity: { fullName: 'Secret' } } as never,
      ],
      listEncounters: async (pid) => (pid === 'p1'
        ? [{ id: 'e1', encounterType: 'consultation', encounterDate: '2024-03-01', validationStatus: 'curated', ageValue: 30, ageUnit: 'years', data: { glasgow_score: 15 } }]
        : []),
      getFields: async () => [{ id: 'f1', fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', displayOrder: 0 }],
    };
    const meta = await downloadBaseSnapshot('bD', src, 5000);
    expect(meta).toMatchObject({ baseId: 'bD', baseName: 'Base D', patientCount: 1 });

    const snap = await offlineCache.get('bD');
    expect(snap?.fields).toHaveLength(1);
    expect(snap?.patients[0].encounters[0].data).toEqual({ glasgow_score: 15 });
    expect(JSON.stringify(snap)).not.toContain('Secret'); // identite jamais persistee
    await offlineCache.remove('bD');
  });
});

describe('outbox — ecritures hors-ligne (Phase 2)', () => {
  test('enqueue : ecrit l entree + reflete la modif dans le cache (pending)', async () => {
    await seedBase('bOB', '2024-01-01T00:00:00.000Z');
    await enqueueEncounterUpdate({
      baseId: 'bOB', patientId: 'p1', encounterId: 'e1',
      data: { glasgow_score: 12 }, reason: 'corr', validationStatus: 'curated', baseUpdatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(await outbox.count('bOB')).toBe(1);
    const e = await cachedEnc('bOB');
    expect(e.data.glasgow_score).toBe(12); // maj optimiste
    expect(e.pending).toBe(true);
  });

  test('flush (succes) : rejoue via la RPC avec le jeton optimiste, vide la file, leve pending', async () => {
    const calls: Array<{ exp: string | null }> = [];
    const deps: FlushDeps = {
      updateEncounter: async (_id, _data, _status, _reason, exp) => { calls.push({ exp }); return {}; },
      getEncounter: async () => ({ data: { glasgow_score: 12 }, updatedAt: '2024-01-02T00:00:00.000Z' }),
    };
    const rep = await flushOutbox(deps, 'bOB');
    expect(rep).toMatchObject({ synced: 1, conflicts: 0, failed: 0 });
    expect(calls[0].exp).toBe('2024-01-01T00:00:00.000Z'); // jeton optimiste transmis
    expect(await outbox.count('bOB')).toBe(0);
    const e = await cachedEnc('bOB');
    expect(e.pending).toBe(false);
    expect(e.updatedAt).toBe('2024-01-02T00:00:00.000Z'); // jeton rafraichi
    await offlineCache.remove('bOB');
  });
});

describe('outbox — conflits (Phase 3)', () => {
  test('flush sur rencontre modifiee entre-temps -> conflit + valeur serveur memorisee', async () => {
    await seedBase('bC', '2024-01-01T00:00:00.000Z');
    await enqueueEncounterUpdate({
      baseId: 'bC', patientId: 'p1', encounterId: 'e1',
      data: { glasgow_score: 12 }, reason: 'corr', validationStatus: 'curated', baseUpdatedAt: '2024-01-01T00:00:00.000Z',
    });
    const deps: FlushDeps = {
      updateEncounter: async () => { throw new Error('CONFLIT_VERSION : la rencontre a ete modifiee entre-temps'); },
      getEncounter: async () => ({ data: { glasgow_score: 9 }, updatedAt: '2024-01-03T00:00:00.000Z' }), // valeur serveur concurrente
    };
    const rep = await flushOutbox(deps, 'bC');
    expect(rep).toMatchObject({ synced: 0, conflicts: 1 });
    const entry = (await outbox.list('bC'))[0];
    expect(entry.state).toBe('conflict');
    expect(entry.serverData).toEqual({ glasgow_score: 9 });
  });

  test('garder ma version : reapplique en forcant (expected=null) puis vide la file', async () => {
    let forced: string | null | undefined = '?';
    const deps: FlushDeps = {
      updateEncounter: async (_id, _data, _status, _reason, exp) => { forced = exp; return {}; },
      getEncounter: async () => ({ data: { glasgow_score: 12 }, updatedAt: '2024-01-04T00:00:00.000Z' }),
    };
    const entry = (await outbox.list('bC'))[0];
    await resolveKeepMine(entry.id, deps);
    expect(forced).toBeNull(); // forcage
    expect(await outbox.count('bC')).toBe(0);
    expect((await cachedEnc('bC')).data.glasgow_score).toBe(12);
    await offlineCache.remove('bC');
  });

  test('garder la version serveur : abandonne ma modif et restaure la valeur serveur', async () => {
    await seedBase('bS', '2024-01-01T00:00:00.000Z');
    await enqueueEncounterUpdate({
      baseId: 'bS', patientId: 'p1', encounterId: 'e1',
      data: { glasgow_score: 12 }, reason: 'corr', validationStatus: 'curated', baseUpdatedAt: '2024-01-01T00:00:00.000Z',
    });
    const deps: FlushDeps = {
      updateEncounter: async () => { throw new Error('CONFLIT_VERSION'); },
      getEncounter: async () => ({ data: { glasgow_score: 7 }, updatedAt: '2024-01-05T00:00:00.000Z' }),
    };
    await flushOutbox(deps, 'bS');
    const entry = (await outbox.list('bS'))[0];
    await resolveKeepServer(entry.id);
    expect(await outbox.count('bS')).toBe(0);
    expect((await cachedEnc('bS')).data.glasgow_score).toBe(7); // valeur serveur restauree
    expect((await cachedEnc('bS')).pending).toBe(false);
    await offlineCache.remove('bS');
  });
});
