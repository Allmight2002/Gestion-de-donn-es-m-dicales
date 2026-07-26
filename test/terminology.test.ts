// Test DB du referentiel de terminologie (feature T1) : lecture seule cote client,
// recherche incrementale bornee, et identifiant stable distinct du libelle.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';
import { importTerminology, parseTerminologyRows, readTextFile } from '../scripts/import-terminology.mjs';

let db: TestDb;
let aliceId: string; // medecin ordinaire
let releaseId: string;
let oldReleaseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const search = async (uid: string, q: string, limit?: number) =>
  (await rowsAs(uid, 'select * from public.search_terminology($1, $2)', [q, limit ?? null])) as
    { id: string; code: string; label: string; kind: string; depth: number }[];

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;

  releaseId = (await db.admin.query(
    `insert into public.terminology_release(slug, title, source, version, is_active, imported_at)
     values('test-actif', 'Referentiel de test', 'test', '1', true, now()) returning id`,
  )).rows[0].id;
  oldReleaseId = (await db.admin.query(
    `insert into public.terminology_release(slug, title, source, version, is_active)
     values('test-ancien', 'Ancien referentiel', 'test', '0', false) returning id`,
  )).rows[0].id;

  const concept = (release: string, code: string, label: string, kind = 'category', selectable = true) =>
    db.admin.query(
      `insert into public.terminology_concept(release_id, code, label, kind, is_selectable)
       values($1, $2, $3, $4, $5)`,
      [release, code, label, kind, selectable],
    );

  await concept(releaseId, '1F40', 'Paludisme');
  await concept(releaseId, '1F41', 'Suspicion de paludisme non confirme');
  await concept(releaseId, '5A11', 'Diabète sucré de type 2');
  await concept(releaseId, 'NB11', "Traumatisme, membre inferieur");
  await concept(releaseId, 'CH01', 'Certaines maladies infectieuses', 'chapter', false);
  await concept(oldReleaseId, 'X999', 'Paludisme (ancienne edition)');
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('T1 referentiel de terminologie', () => {
  test('un compte authentifie lit le referentiel mais ne peut jamais l ecrire', async () => {
    const rows = await rowsAs(aliceId, 'select count(*)::int as n from public.terminology_concept');
    expect(rows[0].n).toBeGreaterThan(0);

    // Aucune politique d'ecriture n'existe : insert, update et delete sont tous refuses.
    await expect(rowsAs(aliceId,
      `insert into public.terminology_concept(release_id, code, label, kind) values($1,'HACK','Faux','category')`,
      [releaseId])).rejects.toThrow();
    await expect(rowsAs(aliceId, `update public.terminology_concept set label = 'Detourne'`)).rejects.toThrow();
    await expect(rowsAs(aliceId, 'delete from public.terminology_concept')).rejects.toThrow();
    await expect(rowsAs(aliceId,
      `insert into public.terminology_release(slug, title, source, version) values('pirate','x','x','1')`))
      .rejects.toThrow();
  });

  test('la recherche ignore accents et casse', async () => {
    const found = await search(aliceId, 'diabete');
    expect(found.map((r) => r.code)).toContain('5A11');
    expect((await search(aliceId, 'DIABÈTE')).map((r) => r.code)).toContain('5A11');
  });

  test('ce qui commence par la saisie est propose en premier', async () => {
    const found = await search(aliceId, 'palu');
    expect(found[0].label).toBe('Paludisme');
    expect(found.map((r) => r.code)).toContain('1F41');
  });

  test('seul le referentiel actif est interroge', async () => {
    const codes = (await search(aliceId, 'palu')).map((r) => r.code);
    expect(codes).not.toContain('X999');
  });

  test('les entrees non selectionnables sont exclues des propositions', async () => {
    expect((await search(aliceId, 'certaines')).length).toBe(0);
  });

  // Une saisie trop courte renverrait presque tout le referentiel : inutile et couteux.
  test('la recherche exige au moins deux caracteres', async () => {
    expect((await search(aliceId, 'p')).length).toBe(0);
    expect((await search(aliceId, '')).length).toBe(0);
  });

  test('les jokers du langage like sont traites comme du texte ordinaire', async () => {
    expect((await search(aliceId, '%%')).length).toBe(0);
    expect((await search(aliceId, 'pa_u')).length).toBe(0);
  });

  // Le libelle contient une virgule : impossible dans l'ancienne saisie a virgules,
  // et sans importance ici puisque la valeur stockee sera le CODE.
  test('un libelle a virgule est cherchable', async () => {
    expect((await search(aliceId, 'traumatisme')).map((r) => r.code)).toContain('NB11');
  });

  test('le nombre de resultats est borne meme si l appelant demande davantage', async () => {
    const found = await search(aliceId, 'a', 500);
    expect(found.length).toBeLessThanOrEqual(50);
    expect((await search(aliceId, 'pal', 1)).length).toBe(1);
  });

  // Un regroupement (chapitre, bloc) n'a pas toujours d'identifiant dans une
  // classification : c'est licite tant qu'il ne peut pas atterrir dans une donnee.
  test('un concept sans code est admis seulement s il n est pas selectionnable', async () => {
    await db.admin.query(
      `insert into public.terminology_concept(release_id, code, label, kind, is_selectable)
       values($1, null, 'Chapitre sans code', 'chapter', false)`,
      [releaseId],
    );
    await expect(db.admin.query(
      `insert into public.terminology_concept(release_id, code, label, kind, is_selectable)
       values($1, null, 'Diagnostic sans code', 'category', true)`,
      [releaseId],
    )).rejects.toThrow(/selectable_has_code/);
  });

  test('un seul referentiel peut etre actif a la fois', async () => {
    await expect(db.admin.query(
      'update public.terminology_release set is_active = true where id = $1', [oldReleaseId],
    )).rejects.toThrow();
  });

  // L'ecriture reelle du referentiel, prouvee contre une base : c'est elle qui inserera
  // des dizaines de milliers de concepts en production.
  test('l import ecrit le referentiel, sa hierarchie et le rend interrogeable', async () => {
    const { concepts } = parseTerminologyRows([
      'Code\tBlockId\tTitle\tClassKind\tDepthInKind',
      '\t\tMaladies infectieuses\tchapter\t1',
      '\tBlockL1-1A0\t- Gastroenterite infectieuse\tblock\t1',
      '1A00\t\t- - Cholera importe\tcategory\t1',
    ].join('\n'));

    const imported = await importTerminology(db.admin, {
      slug: 'import-essai', concepts, title: 'Essai', source: 'test', version: '1',
      license: 'licence-essai', attribution: 'mention-essai', activate: true,
    });
    expect(imported.inserted).toBe(3);

    // Licence et mention d'attribution voyagent avec le referentiel : elles devront etre
    // affichees partout ou il est utilise.
    const meta = (await db.admin.query(
      'select license, attribution from public.terminology_release where id = $1', [imported.releaseId],
    )).rows[0];
    expect(meta.license).toBe('licence-essai');
    expect(meta.attribution).toBe('mention-essai');

    const rows = (await db.admin.query(
      `select c.label, c.code, c.is_selectable, p.label as parent
       from public.terminology_concept c
       left join public.terminology_concept p on p.id = c.parent_id
       where c.release_id = $1 order by c.depth`, [imported.releaseId],
    )).rows;
    expect(rows.map((r) => r.parent)).toEqual([null, 'Maladies infectieuses', 'Gastroenterite infectieuse']);
    expect(rows.map((r) => r.is_selectable)).toEqual([false, false, true]);

    // Le referentiel active devient celui que la recherche interroge.
    expect((await search(aliceId, 'cholera importe')).map((r) => r.code)).toEqual(['1A00']);

    // Recharger sans autorisation explicite est refuse : un referentiel deja utilise ne
    // doit pas disparaitre par accident.
    await expect(importTerminology(db.admin, { slug: 'import-essai', concepts })).rejects.toThrow(/existe deja/);

    const replaced = await importTerminology(db.admin, { slug: 'import-essai', concepts, replace: true, activate: true });
    expect(replaced.inserted).toBe(3);
    expect((await db.admin.query(
      'select count(*)::int as n from public.terminology_concept where release_id = $1', [replaced.releaseId],
    )).rows[0].n).toBe(3);

    // Remettre le referentiel de test en service pour les autres cas.
    await db.admin.query('delete from public.terminology_release where slug = $1', ['import-essai']);
    await db.admin.query('update public.terminology_release set is_active = true where id = $1', [releaseId]);
  });

  // Preuve de bout en bout sur le referentiel REELLEMENT versionne : c'est lui qui sera
  // importe, pas un echantillon. Le fichier est compresse dans le depot.
  test('le referentiel versionne s importe en entier et devient cherchable', async () => {
    const { concepts, skipped } = parseTerminologyRows(
      readTextFile('supabase/terminology/diagnostics-fr.tsv.gz'),
    );
    expect(concepts.length).toBeGreaterThan(30_000);
    expect(skipped.noLabel).toBeGreaterThan(0); // sections non traduites, ecartees

    const imported = await importTerminology(db.admin, {
      slug: 'diagnostics-fr', concepts, title: 'Diagnostics', source: 'fichier fourni',
      version: '2026-07-26', activate: true,
    });

    try {
      expect(imported.inserted).toBe(concepts.length);

      const counts = (await db.admin.query(
        `select count(*)::int as total,
                count(*) filter (where is_selectable)::int as selectables,
                count(*) filter (where code is null)::int as sans_code,
                count(*) filter (where parent_id is null and depth > 0)::int as orphelins_profonds
         from public.terminology_concept where release_id = $1`, [imported.releaseId],
      )).rows[0];
      expect(counts.total).toBe(concepts.length);
      // Tout ce qui est proposable a la saisie porte un identifiant stable.
      expect(counts.selectables).toBeGreaterThan(30_000);
      expect(counts.sans_code).toBeGreaterThan(0);

      // Un concept profond sans parent signale une branche dont TOUS les ancetres ont ete
      // ecartes faute de libelle. Le cas existe mais doit rester marginal ; s'il explosait,
      // c'est que la reconstruction de la hierarchie aurait derape.
      expect(counts.orphelins_profonds).toBeLessThan(10);

      // Invariante de coherence : un parent est toujours moins profond que son enfant.
      // C'est elle qui garantit qu'aucune entree n'a ete adoptee par une branche voisine.
      const incoherents = (await db.admin.query(
        `select count(*)::int as n
         from public.terminology_concept c
         join public.terminology_concept p on p.id = c.parent_id
         where c.release_id = $1 and p.depth >= c.depth`, [imported.releaseId],
      )).rows[0].n;
      expect(incoherents).toBe(0);

      const found = await search(aliceId, 'cholera');
      expect(found.length).toBeGreaterThan(0);
      expect(found.every((r) => r.code !== null)).toBe(true);
    } finally {
      // Rendu obligatoire : un echec d'assertion ne doit pas laisser un autre referentiel
      // actif, sous peine de faire tomber les tests suivants pour une mauvaise raison.
      await db.admin.query('delete from public.terminology_release where slug = $1', ['diagnostics-fr']);
      await db.admin.query('update public.terminology_release set is_active = true where id = $1', [releaseId]);
    }
  }, 180_000);

  // L'identifiant stable est le code : corriger un libelle ne doit rien casser.
  test('corriger un libelle ne change pas le code du concept', async () => {
    await db.admin.query(
      `update public.terminology_concept set label = 'Paludisme grave' where release_id = $1 and code = '1F40'`,
      [releaseId],
    );
    const found = await search(aliceId, 'paludisme grave');
    expect(found[0].code).toBe('1F40');
    await db.admin.query(
      `update public.terminology_concept set label = 'Paludisme' where release_id = $1 and code = '1F40'`,
      [releaseId],
    );
  });
});
