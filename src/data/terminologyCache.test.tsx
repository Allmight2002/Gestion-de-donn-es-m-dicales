// @vitest-environment jsdom
// F7 : copie locale du referentiel. Le point critique est que la recherche locale rende
// EXACTEMENT ce que rendrait le serveur — sinon les propositions changeraient selon qu'on
// est connecte ou non, ce qui serait pire que pas de copie du tout.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  cacheFreshness, cacheIsCurrent, cacheStatus, clearCache, downloadReference, normalizeQuery, searchLocal,
} from './terminologyCache';
import { makeTerminologyRepository, type TerminologyEntry, type TerminologyRepository } from './terminology';

const RELEASE_ID = '00000000-0000-4000-8000-000000000001';

const ENTREES: TerminologyEntry[] = [
  { code: '1A00', label: 'Choléra', searchText: 'cholera' },
  { code: '5A10', label: 'Diabète sucré de type 1', searchText: 'diabete sucre de type 1' },
  { code: '5A11', label: 'Diabète sucré de type 2', searchText: 'diabete sucre de type 2' },
  { code: 'KB60', label: 'Diabète néonatal', searchText: 'diabete neonatal' },
  { code: 'MD11', label: 'Fièvre', searchText: 'fievre' },
];

function repo(over: Partial<TerminologyRepository> = {}): TerminologyRepository {
  return {
    search: async () => [],
    activeRelease: async () => ({ id: RELEASE_ID, slug: 'diagnostics-fr', version: '1', conceptCount: ENTREES.length }),
    listEntries: async (_releaseId, offset, limit) => ({
      entries: ENTREES.slice(offset, offset + limit),
      total: ENTREES.length,
    }),
    ...over,
  };
}

beforeEach(async () => { await clearCache(); });

describe('normalizeQuery', () => {
  // Doit reproduire terminology_normalize cote base : une divergence ferait diverger les
  // resultats locaux de ceux du serveur.
  test('ramene accents, casse et apostrophes a la meme forme que le serveur', () => {
    expect(normalizeQuery('DIABÈTE')).toBe('diabete');
    expect(normalizeQuery('Fièvre')).toBe('fievre');
    expect(normalizeQuery('d’autres')).toBe("d'autres");
    expect(normalizeQuery('Œdème')).toBe('odeme');
  });
});

describe('copie locale', () => {
  test('absente au depart', async () => {
    expect(await cacheStatus()).toBeNull();
    expect(await searchLocal('diabete')).toEqual([]);
  });

  test('le telechargement enregistre les entrees et la publication', async () => {
    const status = await downloadReference(repo());
    expect(status.count).toBe(ENTREES.length);
    expect(status.releaseId).toBe(RELEASE_ID);
    expect(status.slug).toBe('diagnostics-fr');
    expect((await cacheStatus())?.count).toBe(ENTREES.length);
  });

  test('la progression est rapportee, sans quoi l attente paraitrait figee', async () => {
    const vus: number[] = [];
    await downloadReference(repo(), (recus) => vus.push(recus));
    expect(vus.length).toBeGreaterThan(0);
    expect(vus.at(-1)).toBe(ENTREES.length);
  });

  test('la recherche locale ignore accents et casse', async () => {
    await downloadReference(repo());
    expect((await searchLocal('DIABÈTE')).map((r) => r.code)).toContain('5A10');
    expect((await searchLocal('cholera')).map((r) => r.code)).toEqual(['1A00']);
  });

  // Meme classement que le serveur : prefixe d'abord, puis libelle le plus court.
  test('classe comme le serveur : ce qui commence par la saisie d abord', async () => {
    await downloadReference(repo());
    const trouves = await searchLocal('diabete');
    expect(trouves[0].label).toBe('Diabète néonatal');
    expect(trouves.map((r) => r.code)).toEqual(['KB60', '5A10', '5A11']);
  });

  test('exige deux caracteres, comme le serveur', async () => {
    await downloadReference(repo());
    expect(await searchLocal('d')).toEqual([]);
  });

  test('borne le nombre de resultats', async () => {
    await downloadReference(repo());
    expect((await searchLocal('diabete', 2)).length).toBe(2);
  });

  test('une copie d une autre publication est signalee comme perimee', async () => {
    await downloadReference(repo());
    expect(await cacheIsCurrent(repo())).toBe(true);
    const neuf = repo({
      activeRelease: async () => ({
        id: '00000000-0000-4000-8000-000000000002',
        slug: 'diagnostics-fr',
        version: '1',
        conceptCount: 5,
      }),
    });
    expect(await cacheIsCurrent(neuf)).toBe(false);
    expect(await cacheFreshness(neuf)).toBe('stale');
  });

  test('un referentiel absent cote serveur ne produit pas de copie muette', async () => {
    await expect(downloadReference(repo({ activeRelease: async () => null }))).rejects.toThrow(/référentiel actif/i);
  });

  test('effacer la copie ramene a la recherche serveur', async () => {
    await downloadReference(repo());
    await clearCache();
    expect(await cacheStatus()).toBeNull();
    expect(await searchLocal('diabete')).toEqual([]);
  });

  // Le telechargement remplace : sans cela, un ancien concept retire du referentiel
  // resterait proposable localement alors que le serveur le refuserait a l'ecriture.
  test('un nouveau telechargement remplace l ancien contenu', async () => {
    await downloadReference(repo());
    const reduit = repo({
      listEntries: async (_releaseId, offset, limit) => ({
        entries: ENTREES.slice(0, 1).slice(offset, offset + limit),
        total: 1,
      }),
      activeRelease: async () => ({
        id: '00000000-0000-4000-8000-000000000002',
        slug: 'diagnostics-fr',
        version: '2',
        conceptCount: 1,
      }),
    });
    await downloadReference(reduit);
    expect((await cacheStatus())?.count).toBe(1);
    expect(await searchLocal('diabete')).toEqual([]);
  });

  test('la pagination recupere toutes les entrees', async () => {
    // Simule un plafond PostgREST plus bas que la page demandee : une page courte ne signifie
    // pas que le referentiel est termine tant que le compte exact annonce encore des lignes.
    const listEntries = vi.fn(async (releaseId: string, offset: number, limit: number) => ({
      entries: releaseId === RELEASE_ID ? ENTREES.slice(offset, offset + Math.min(limit, 2)) : [],
      total: ENTREES.length,
    }));
    await downloadReference(repo({ listEntries }));
    expect((await cacheStatus())?.count).toBe(ENTREES.length);
    expect(listEntries).toHaveBeenCalledTimes(3);
    expect(listEntries.mock.calls.every(([releaseId]) => releaseId === RELEASE_ID)).toBe(true);
  });

  test('un changement de publication pendant le telechargement efface la copie partielle', async () => {
    const activeRelease = vi.fn()
      .mockResolvedValueOnce({ id: RELEASE_ID, slug: 'diagnostics-fr', version: '1', conceptCount: ENTREES.length })
      .mockResolvedValueOnce({
        id: '00000000-0000-4000-8000-000000000002',
        slug: 'diagnostics-fr',
        version: '2',
        conceptCount: ENTREES.length,
      });
    await expect(downloadReference(repo({ activeRelease }))).rejects.toThrow(/actif a changé/i);
    expect(await cacheStatus()).toBeNull();
    expect(await searchLocal('diabete')).toEqual([]);
  });

  test('le repository filtre chaque page sur la publication demandee et exige un compte exact', async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.not = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.range = vi.fn(async () => ({
      data: [{ code: '1A00', label: 'Choléra', search_text: 'cholera' }],
      error: null,
      count: 1,
    }));
    const client = { from: vi.fn(() => builder) };
    const page = await makeTerminologyRepository(client as never).listEntries(RELEASE_ID, 0, 1000);
    expect(builder.select).toHaveBeenCalledWith('code, label, search_text', { count: 'exact' });
    expect(builder.eq).toHaveBeenCalledWith('release_id', RELEASE_ID);
    expect(page).toEqual({ entries: [ENTREES[0]], total: 1 });
  });
});
