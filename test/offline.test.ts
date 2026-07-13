// Tests du cache HORS-LIGNE (Phase 1) : garantie "analytique seulement" (aucune identite) +
// stockage IndexedDB (via fake-indexeddb). Tourne en node, sans PostgreSQL.
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildSnapshot, clearOfflineSnapshots, downloadBaseSnapshot, enqueueEncounterUpdate, flushOutbox,
  isExpired, offlineCache, OFFLINE_TTL_MS, OUTBOX_TTL_MS, outbox, purgeExpiredOutbox, purgeExpiredSnapshots,
  recoverAbandonedSyncing, resolveKeepMine,
  resolveKeepServer, setOfflineUser, type FlushDeps, type SnapshotSource,
} from '../src/data/offline.js';

beforeAll(() => {
  vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  vi.stubEnv('VITE_OFFLINE_ADMIN_ACK', 'true');
});
beforeEach(() => setOfflineUser('offline-test-user'));
afterAll(() => vi.unstubAllEnvs());

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
    const meta = await downloadBaseSnapshot('bD', src); // now=Date.now() -> instantane frais (TTL §5.6)
    expect(meta).toMatchObject({ baseId: 'bD', baseName: 'Base D', patientCount: 1 });

    const snap = await offlineCache.get('bD');
    expect(snap?.fields).toHaveLength(1);
    expect(snap?.patients[0].encounters[0].data).toEqual({ glasgow_score: 15 });
    expect(JSON.stringify(snap)).not.toContain('Secret'); // identite jamais persistee
    await offlineCache.remove('bD');
  });

  test('§8 utilise fetchSnapshot (1 appel) si disponible et NE fait PAS le N+1', async () => {
    let nPlusOne = 0;
    const boom = async (): Promise<never> => { throw new Error('chemin de repli : ne doit pas etre appele'); };
    const src: SnapshotSource = {
      fetchSnapshot: async () => ({
        base: { id: 'bS1', name: 'Base S1', templateVersionId: 'v9' },
        fields: [{ id: 'f1', fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', displayOrder: 0 }],
        patients: [
          {
            id: 'p1', code: 'S-001', templateVersionId: 'v9', data: { sexe: 'M' }, validationStatus: 'curated',
            encounters: [{ id: 'e1', encounterType: 'consultation', encounterDate: '2024-03-01', validationStatus: 'curated', ageValue: 30, ageUnit: 'years', data: { glasgow_score: 15 }, updatedAt: null }],
          },
        ],
      }),
      getBase: boom,
      listPatients: boom,
      listEncounters: async () => { nPlusOne += 1; return []; },
      getFields: boom,
    };
    const meta = await downloadBaseSnapshot('bS1', src);
    expect(meta).toMatchObject({ baseId: 'bS1', baseName: 'Base S1', patientCount: 1 });
    expect(nPlusOne).toBe(0); // §8 : aucune requete rencontre-par-patient
    const snap = await offlineCache.get('bS1');
    expect(snap?.fields).toHaveLength(1);
    expect(snap?.patients[0].encounters[0].data).toEqual({ glasgow_score: 15 });
    await offlineCache.remove('bS1');
  });

  test('§8 si fetchSnapshot echoue (RPC absente), repli transparent sur le N+1', async () => {
    let nPlusOne = 0;
    const src: SnapshotSource = {
      fetchSnapshot: async () => { throw new Error('function download_base_snapshot does not exist'); },
      getBase: async () => ({ base: { id: 'bF', name: 'Base F', currentTemplateVersionId: 'v9' } }),
      listPatients: async () => [{ id: 'p1', code: 'F-001', templateVersionId: 'v9', data: { sexe: 'M' }, validationStatus: 'curated' }],
      listEncounters: async () => { nPlusOne += 1; return [{ id: 'e1', encounterType: 'consultation', encounterDate: '2024-03-01', validationStatus: 'curated', ageValue: 30, ageUnit: 'years', data: { glasgow_score: 12 } }]; },
      getFields: async () => [{ id: 'f1', fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', displayOrder: 0 }],
    };
    const meta = await downloadBaseSnapshot('bF', src);
    expect(meta).toMatchObject({ baseId: 'bF', patientCount: 1 });
    expect(nPlusOne).toBe(1); // repli : la voie N+1 a bien ete empruntee
    expect((await offlineCache.get('bF'))?.patients[0].encounters[0].data).toEqual({ glasgow_score: 12 });
    await offlineCache.remove('bF');
  });

  test('§7.6 une erreur NON « RPC absente » (autorisation/serveur) REMONTE et ne declenche pas le repli', async () => {
    let nPlusOne = 0;
    const src: SnapshotSource = {
      // Erreur d'autorisation cote serveur : surtout PAS un repli silencieux qui masquerait l'anomalie.
      fetchSnapshot: async () => { throw Object.assign(new Error('permission denied for function download_base_snapshot'), { code: '42501' }); },
      getBase: async () => ({ base: { id: 'bE', name: 'Base E', currentTemplateVersionId: 'v9' } }),
      listPatients: async () => [],
      listEncounters: async () => { nPlusOne += 1; return []; },
      getFields: async () => [],
    };
    await expect(downloadBaseSnapshot('bE', src)).rejects.toThrow(/permission denied/i);
    expect(nPlusOne).toBe(0); // le repli N+1 n'a PAS ete emprunte
  });

  test('§5.7 fieldsByVersion + version des rencontres conserves dans le cache', async () => {
    setOfflineUser('uV');
    const src: SnapshotSource = {
      fetchSnapshot: async () => ({
        base: { id: 'bV', name: 'Base V', templateVersionId: 'v2' },
        fields: [{ id: 'f2', fieldKey: 'x', label: 'X v2', scope: 'patient', type: 'text', displayOrder: 0 }],
        fieldsByVersion: {
          v1: [{ id: 'f1', fieldKey: 'x', label: 'X v1', scope: 'patient', type: 'text', displayOrder: 0 }],
          v2: [{ id: 'f2', fieldKey: 'x', label: 'X v2', scope: 'patient', type: 'text', displayOrder: 0 }],
        },
        rulesByVersion: {
          v1: [{ id: 'r1', rule: { operator: 'equals', left_field: 'x', right_field: 'x' }, message: 'ok', severity: 'block' }],
        },
        patients: [{
          id: 'p1', code: 'V-1', templateVersionId: 'v1', data: { x: 'a' }, validationStatus: 'curated',
          encounters: [{ id: 'e1', encounterType: 'consultation', encounterDate: '2024-01-01', validationStatus: 'curated', ageValue: null, ageUnit: null, data: {}, updatedAt: null, templateVersionId: 'v1' }],
        }],
      }),
      getBase: async () => null, listPatients: async () => [], listEncounters: async () => [], getFields: async () => [],
    };
    await downloadBaseSnapshot('bV', src);
    const snap = await offlineCache.get('bV');
    expect(snap?.fieldsByVersion?.v1?.[0].label).toBe('X v1'); // l'ancienne version garde son dico
    expect(snap?.rulesByVersion?.v1?.[0].message).toBe('ok');
    expect(snap?.patients[0].encounters[0].templateVersionId).toBe('v1'); // version portee par la rencontre
    await offlineCache.remove('bV');
    setOfflineUser(null);
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

  test('erreur reseau : revient pending, conserve les donnees puis reussit au retry sans double envoi', async () => {
    await seedBase('b-network', '2024-01-01T00:00:00.000Z');
    await enqueueEncounterUpdate({
      baseId: 'b-network', patientId: 'p1', encounterId: 'e1', data: { score: 12 },
      reason: 'reseau', validationStatus: 'draft', baseUpdatedAt: null,
    });
    let calls = 0;
    const deps: FlushDeps = {
      updateEncounter: async () => { calls++; if (calls === 1) throw new TypeError('Failed to fetch'); },
      getEncounter: async () => ({ data: { score: 12 }, updatedAt: '2024-01-02T00:00:00.000Z' }),
    };
    expect(await flushOutbox(deps, 'b-network')).toMatchObject({ failed: 1, synced: 0 });
    expect((await outbox.list('b-network'))[0]).toMatchObject({ state: 'pending', attemptCount: 1, lastError: 'Failed to fetch' });
    expect(await flushOutbox(deps, 'b-network')).toMatchObject({ failed: 0, synced: 1 });
    expect(await outbox.count('b-network')).toBe(0);
    await flushOutbox(deps, 'b-network');
    expect(calls).toBe(2);
    await offlineCache.remove('b-network');
  });

  test('HTTP 5xx reste rejouable et une permission refusee devient rejected visible', async () => {
    await seedBase('b-errors', '2024-01-01T00:00:00.000Z');
    await enqueueEncounterUpdate({
      baseId: 'b-errors', patientId: 'p1', encounterId: 'e1', data: { score: 8 },
      reason: 'serveur', validationStatus: 'draft', baseUpdatedAt: null,
    });
    await flushOutbox({
      updateEncounter: async () => { throw Object.assign(new Error('Service unavailable'), { status: 503 }); },
      getEncounter: async () => null,
    }, 'b-errors');
    expect((await outbox.list('b-errors'))[0].state).toBe('pending');
    await flushOutbox({
      updateEncounter: async () => { throw Object.assign(new Error('permission denied'), { status: 403 }); },
      getEncounter: async () => null,
    }, 'b-errors');
    expect((await outbox.list('b-errors'))[0]).toMatchObject({ state: 'rejected', attemptCount: 2, lastError: 'permission denied' });
    await outbox.remove((await outbox.list('b-errors'))[0].id);
    await offlineCache.remove('b-errors');
  });

  test('une fermeture simulee reprend une entree syncing en pending', async () => {
    await seedBase('b-resume', '2024-01-01T00:00:00.000Z');
    const entry = await enqueueEncounterUpdate({
      baseId: 'b-resume', patientId: 'p1', encounterId: 'e1', data: { score: 9 },
      reason: 'reprise', validationStatus: 'draft', baseUpdatedAt: null,
    });
    await outbox.put({ ...entry, state: 'syncing', syncingStartedAt: Date.now() - 1000 });
    expect(await recoverAbandonedSyncing('b-resume')).toBe(1);
    expect((await outbox.get(entry.id))?.state).toBe('pending');
    await outbox.remove(entry.id);
    await offlineCache.remove('b-resume');
  });
});

describe('§5.5 cloisonnement par utilisateur (poste partage)', () => {
  test('un compte ne lit ni les instantanes ni l outbox d un autre', async () => {
    setOfflineUser('userA');
    await seedBase('isoA', '2024-01-01T00:00:00.000Z');
    await enqueueEncounterUpdate({
      baseId: 'isoA', patientId: 'p1', encounterId: 'e1',
      data: { glasgow_score: 11 }, reason: 'a', validationStatus: 'curated', baseUpdatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(await offlineCache.get('isoA')).not.toBeNull();
    expect(await outbox.count('isoA')).toBe(1);

    // Bascule de compte sur le MEME appareil : rien ne doit fuiter vers B.
    setOfflineUser('userB');
    expect(await offlineCache.get('isoA')).toBeNull();
    expect((await offlineCache.list()).find((m) => m.baseId === 'isoA')).toBeUndefined();
    expect(await outbox.count('isoA')).toBe(0);
    expect(await outbox.list()).toHaveLength(0);

    // Retour au compte A : ses donnees sont intactes.
    setOfflineUser('userA');
    expect(await offlineCache.get('isoA')).not.toBeNull();
    expect(await outbox.count('isoA')).toBe(1);

    const mine = (await outbox.list('isoA'))[0];
    await outbox.remove(mine.id);
    await offlineCache.remove('isoA');
    setOfflineUser(null);
  });
});

describe('§5.6 expiration des instantanes', () => {
  test('un instantane expire n est ni lu ni liste (purge a la lecture)', async () => {
    setOfflineUser('userExp');
    await offlineCache.save(buildSnapshot(
      { id: 'expB', name: 'Expire', templateVersionId: 'v1' },
      [{ id: 'p1', code: 'C1', templateVersionId: 'v1', data: {}, validationStatus: 'draft' }],
      {}, [], Date.now() - OFFLINE_TTL_MS - 1000, // deja expire
    ));
    expect(await offlineCache.get('expB')).toBeNull();
    expect((await offlineCache.list()).find((m) => m.baseId === 'expB')).toBeUndefined();
    setOfflineUser(null);
  });

  test('purgeExpiredSnapshots supprime les expires (tous comptes) et garde les frais', async () => {
    setOfflineUser('u1');
    await offlineCache.save(buildSnapshot({ id: 'pex', name: 'x', templateVersionId: null }, [], {}, [], Date.now() - OFFLINE_TTL_MS - 1000));
    setOfflineUser('u2');
    await offlineCache.save(buildSnapshot({ id: 'pfresh', name: 'y', templateVersionId: null }, [], {}, [], Date.now()));
    setOfflineUser(null);
    await purgeExpiredSnapshots();
    setOfflineUser('u1'); expect(await offlineCache.get('pex')).toBeNull();
    setOfflineUser('u2'); expect(await offlineCache.get('pfresh')).not.toBeNull();
    await offlineCache.remove('pfresh');
    setOfflineUser(null);
  });

  test('clearOfflineSnapshots (deconnexion) vide les instantanes mais CONSERVE l outbox', async () => {
    setOfflineUser('uClr');
    await seedBase('clrB', '2024-01-01T00:00:00.000Z');
    await enqueueEncounterUpdate({
      baseId: 'clrB', patientId: 'p1', encounterId: 'e1',
      data: { glasgow_score: 12 }, reason: 'c', validationStatus: 'curated', baseUpdatedAt: '2024-01-01T00:00:00.000Z',
    });
    await clearOfflineSnapshots();
    expect(await offlineCache.get('clrB')).toBeNull(); // donnees analytiques effacees
    expect(await outbox.count('clrB')).toBe(1);        // travail hors-ligne preserve
    const e = (await outbox.list('clrB'))[0];
    await outbox.remove(e.id);
    setOfflineUser(null);
  });
});

describe('§5.9 cle IndexedDB composite (deux comptes, meme base)', () => {
  test('deux comptes cachent la MEME base sans s ecraser', async () => {
    setOfflineUser('userA');
    await offlineCache.save(buildSnapshot({ id: 'shared', name: 'Version A', templateVersionId: 'v1' },
      [{ id: 'pA', code: 'A-1', templateVersionId: 'v1', data: {}, validationStatus: 'draft' }], {}, [], Date.now()));
    setOfflineUser('userB');
    await offlineCache.save(buildSnapshot({ id: 'shared', name: 'Version B', templateVersionId: 'v1' },
      [{ id: 'pB1', code: 'B-1', templateVersionId: 'v1', data: {}, validationStatus: 'draft' },
       { id: 'pB2', code: 'B-2', templateVersionId: 'v1', data: {}, validationStatus: 'draft' }], {}, [], Date.now()));

    // Chaque compte retrouve SON instantane (B n'a pas ecrase A).
    setOfflineUser('userA');
    const a = await offlineCache.get('shared');
    expect(a?.baseName).toBe('Version A');
    expect(a?.patients).toHaveLength(1);
    setOfflineUser('userB');
    const b = await offlineCache.get('shared');
    expect(b?.baseName).toBe('Version B');
    expect(b?.patients).toHaveLength(2);

    // §5.9 : la deconnexion de B n'efface QUE les instantanes de B (celui de A reste).
    await clearOfflineSnapshots(); // currentUser = userB
    expect(await offlineCache.get('shared')).toBeNull();
    setOfflineUser('userA');
    expect((await offlineCache.get('shared'))?.baseName).toBe('Version A');
    await offlineCache.remove('shared');
    setOfflineUser(null);
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

describe('securite de conservation hors-ligne', () => {
  test('une outbox expiree est purgee et ne peut pas etre synchronisee', async () => {
    setOfflineUser('expiry-user');
    await seedBase('ttl-outbox', '2024-01-01T00:00:00.000Z');
    await enqueueEncounterUpdate({
      baseId: 'ttl-outbox', patientId: 'p1', encounterId: 'e1', data: { score: 1 },
      reason: 'test', validationStatus: 'draft', baseUpdatedAt: null,
    });
    const entry = (await outbox.list('ttl-outbox'))[0];
    expect(entry.expiresAt - entry.createdAt).toBe(OUTBOX_TTL_MS);
    await outbox.put({ ...entry, expiresAt: Date.now() - 1 });
    expect(await purgeExpiredOutbox()).toBe(1);
    expect(await outbox.count('ttl-outbox')).toBe(0);
    await offlineCache.remove('ttl-outbox');
    setOfflineUser(null);
  });

  test('mode desactive : aucun snapshot ni ajout outbox n est enregistre', async () => {
    vi.stubEnv('VITE_OFFLINE_MODE', 'disabled');
    const snapshot = buildSnapshot({ id: 'disabled', name: 'x', templateVersionId: null }, [], {}, []);
    await expect(offlineCache.save(snapshot)).rejects.toThrow(/desactive/i);
    await expect(enqueueEncounterUpdate({
      baseId: 'disabled', patientId: 'p1', encounterId: 'e1', data: {}, reason: 'x',
      validationStatus: 'draft', baseUpdatedAt: null,
    })).rejects.toThrow(/desactive/i);
    expect(await outbox.count('disabled')).toBe(0);
    vi.stubEnv('VITE_OFFLINE_MODE', 'demo');
  });

  test('le stockage construit exclut identite, piece jointe et document brut', () => {
    const snapshot = buildSnapshot(
      { id: 'safe', name: 'safe', templateVersionId: 'v1' },
      [{
        id: 'p1', code: 'P-1', templateVersionId: 'v1', data: { score: 1 }, validationStatus: 'draft',
        identity: { fullName: 'Identite Secrete' }, rawDocument: { name: 'document-secret.pdf' }, attachments: ['scan-secret.png'],
      } as never],
      {},
    );
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('Identite Secrete');
    expect(serialized).not.toContain('document-secret.pdf');
    expect(serialized).not.toContain('scan-secret.png');
  });
});
