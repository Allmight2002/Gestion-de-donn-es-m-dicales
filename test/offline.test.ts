// Tests du cache HORS-LIGNE (Phase 1) : garantie "analytique seulement" (aucune identite) +
// stockage IndexedDB (via fake-indexeddb). Tourne en node, sans PostgreSQL.
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { buildSnapshot, downloadBaseSnapshot, isExpired, offlineCache, OFFLINE_TTL_MS, type SnapshotSource } from '../src/data/offline.js';

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
