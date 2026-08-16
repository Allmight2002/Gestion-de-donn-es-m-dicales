// Test DB des sections personnalisables (L31).
//
// Le lot tient sur quatre promesses, et chacune a son bloc ci-dessous :
//   1. LE REPLI ne change rien : toute base existante conserve ses trois sections, dans
//      leur ordre, et aucune variable ne change de section ;
//   2. LE MIROIR marche dans les deux sens : un client a jour ecrit `section_id`, un
//      client non rafraichi n'ecrit que le code texte, et les deux se rejoignent ;
//   3. LE FILET tient : une variable dont la section est inconnue garde son code et n'est
//      jamais refusee — la faire disparaitre du formulaire serait pire que tout ;
//   4. LE GEL suit la version publiee, exactement comme pour les variables, et une section
//      encore peuplee ne se supprime pas.
//
// Les chemins de refus comptent autant que les chemins nominaux : ce sont eux qui
// empechent un formulaire de production de changer d'apparence sans decision.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let versionId: string;
let templateId: string;
let baseId: string;
let aliceId: string;

const sectionsOf = async (version: string): Promise<{ section_key: string; label: string; display_order: number }[]> =>
  (await db.admin.query(
    'select section_key, label, display_order from public.template_section where template_version_id = $1 order by display_order, section_key',
    [version],
  )).rows;

const sectionId = async (version: string, key: string): Promise<string> =>
  (await db.admin.query(
    'select id from public.template_section where template_version_id = $1 and section_key = $2',
    [version, key],
  )).rows[0]?.id;

const fieldRow = async (fieldKey: string, version = versionId) =>
  (await db.admin.query(
    'select id, section, section_id from public.template_field where template_version_id = $1 and field_key = $2',
    [version, fieldKey],
  )).rows[0];

async function addField(fieldKey: string, section: string, order: number, version = versionId) {
  await db.admin.query(
    `insert into public.template_field
       (template_version_id, field_key, label, scope, section, type, display_order)
     values ($1, $2, $3, 'encounter', $4, 'text', $5)`,
    [version, fieldKey, `Libelle ${fieldKey}`, section, order],
  );
}

/** Nouvelle version brouillon du meme gabarit, alimentee par la recopie. */
async function nextDraftVersion(): Promise<string> {
  const n = (await db.admin.query(
    'select coalesce(max(version_number), 0) + 1 as n from public.template_version where template_id = $1',
    [templateId],
  )).rows[0].n;
  const id = (await db.admin.query(
    `insert into public.template_version (template_id, version_number, status, created_by)
     values ($1, $2, 'draft', $3) returning id`,
    [templateId, n, aliceId],
  )).rows[0].id;
  await db.admin.query('select public.copy_template_fields($1, $2)', [versionId, id]);
  return id;
}

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  aliceId = (await db.admin.query("select id from auth.users where email = 'alice@demo.test'")).rows[0].id;
  const base = (await db.admin.query(
    'select id, current_template_version_id as v from public.base where owner_user_id = $1 limit 1',
    [aliceId],
  )).rows[0];
  baseId = base.id;
  versionId = base.v;
  templateId = (await db.admin.query(
    'select template_id from public.template_version where id = $1', [versionId],
  )).rows[0].template_id;
}, 240_000);

afterAll(async () => {
  await db?.stop();
});

// ---------------------------------------------------------------------------
// 1. Repli : une base existante ne bouge pas
// ---------------------------------------------------------------------------

describe('repli des bases existantes', () => {
  test('toute version existante recoit les trois sections historiques, dans leur ordre', async () => {
    expect(await sectionsOf(versionId)).toEqual([
      { section_key: 'clinique', label: 'Clinique', display_order: 0 },
      { section_key: 'biologie', label: 'Biologie', display_order: 1 },
      { section_key: 'paraclinique', label: 'Paraclinique', display_order: 2 },
    ]);
  });

  test('AUCUNE variable du seed ne change de section', async () => {
    // Le code textuel est la garantie visible cote client non rafraichi : s'il bougeait,
    // un formulaire deja en service changerait d'apparence au deploiement.
    const rows = (await db.admin.query(
      `select tf.field_key, tf.section, ts.section_key
         from public.template_field tf
         join public.template_section ts on ts.id = tf.section_id
        where tf.template_version_id = $1`,
      [versionId],
    )).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.section).toBe(row.section_key);
  });

  test('chaque variable est rattachee a une section : aucune orpheline apres reprise', async () => {
    const orphelines = (await db.admin.query(
      'select count(*)::int as n from public.template_field where section_id is null',
    )).rows[0].n;
    expect(orphelines).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Miroir : les deux sens
// ---------------------------------------------------------------------------

describe('miroir entre le code et le lien', () => {
  test('un client A JOUR ecrit section_id -> le code texte en est deduit', async () => {
    const imagerie = (await db.admin.query(
      `insert into public.template_section (template_version_id, section_key, label, display_order)
       values ($1, 'imagerie', 'Imagerie', 3) returning id`,
      [versionId],
    )).rows[0].id;
    await db.admin.query(
      `insert into public.template_field
         (template_version_id, field_key, label, scope, section, section_id, type, display_order)
       values ($1, 'l31_tdm', 'TDM', 'encounter', 'clinique', $2, 'boolean', 900)`,
      [versionId, imagerie],
    );
    // La ligne a ete inseree avec `section = 'clinique'` ET le lien vers `imagerie` : le
    // lien fait foi, sinon deux sources de verite se contrediraient en base.
    const row = await fieldRow('l31_tdm');
    expect(row.section).toBe('imagerie');
    expect(row.section_id).toBe(imagerie);
  });

  test('un client NON RAFRAICHI n ecrit que le code -> le lien est retrouve', async () => {
    await addField('l31_ancien_client', 'biologie', 901);
    const row = await fieldRow('l31_ancien_client');
    expect(row.section).toBe('biologie');
    expect(row.section_id).toBe(await sectionId(versionId, 'biologie'));
  });

  test('deplacer une variable par le seul code texte reaccroche le lien', async () => {
    await db.admin.query(
      "update public.template_field set section = 'imagerie' where template_version_id = $1 and field_key = 'l31_ancien_client'",
      [versionId],
    );
    const row = await fieldRow('l31_ancien_client');
    expect(row.section_id).toBe(await sectionId(versionId, 'imagerie'));
  });

  test('un section_id d une AUTRE version est refuse', async () => {
    const autre = await nextDraftVersion();
    const etrangere = await sectionId(autre, 'clinique');
    await expect(db.admin.query(
      'update public.template_field set section_id = $2 where template_version_id = $1 and field_key = $3',
      [versionId, etrangere, 'l31_tdm'],
    )).rejects.toThrow(/Section inconnue/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Filet : une variable ne disparait jamais
// ---------------------------------------------------------------------------

describe('filet de secours', () => {
  test('une section inconnue ne fait PAS echouer l ecriture : le code est conserve', async () => {
    // C'est le coeur du point 4 du lot. Refuser ici ferait disparaitre la variable du
    // formulaire — un champ invisible n'est jamais saisi, et personne ne s'en apercoit.
    await addField('l31_section_inconnue', 'section_jamais_creee', 902);
    const row = await fieldRow('l31_section_inconnue');
    expect(row.section).toBe('section_jamais_creee');
    expect(row.section_id).toBeNull();
  });

  test('supprimer une section VIDE detache sans supprimer de variable', async () => {
    await db.admin.query(
      `insert into public.template_section (template_version_id, section_key, label, display_order)
       values ($1, 'ephemere', 'Ephemere', 9)`,
      [versionId],
    );
    await db.admin.query(
      "delete from public.template_section where template_version_id = $1 and section_key = 'ephemere'",
      [versionId],
    );
    expect(await sectionId(versionId, 'ephemere')).toBeUndefined();
  });

  test('le code de section reste contraint en FORME : une valeur illisible est refusee', async () => {
    await expect(addField('l31_forme', 'Imagerie Cérébrale !', 903))
      .rejects.toThrow(/section_format_check/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Gel de version, code immuable, suppression sure
// ---------------------------------------------------------------------------

describe('gel et garde-fous', () => {
  test('le code interne d une section ne se modifie jamais', async () => {
    await expect(db.admin.query(
      "update public.template_section set section_key = 'autre_code' where template_version_id = $1 and section_key = 'imagerie'",
      [versionId],
    )).rejects.toThrow(/code interne/i);
  });

  test('le LIBELLE se corrige, lui, et les variables ne bougent pas', async () => {
    await db.admin.query(
      "update public.template_section set label = 'Imagerie cerebrale' where template_version_id = $1 and section_key = 'imagerie'",
      [versionId],
    );
    const row = await fieldRow('l31_tdm');
    expect(row.section).toBe('imagerie');
  });

  test('une section encore peuplee ne se supprime pas', async () => {
    await expect(db.admin.query(
      "delete from public.template_section where template_version_id = $1 and section_key = 'imagerie'",
      [versionId],
    )).rejects.toThrow(/non vide/i);
  });

  test('la recopie d une version emporte les sections AVANT les variables', async () => {
    // Lecon de L28, L30 et L33 : une structure oubliee ici se perd en silence.
    const copie = await nextDraftVersion();
    const keys = (await sectionsOf(copie)).map((s) => s.section_key);
    expect(keys).toContain('imagerie');
    const row = await fieldRow('l31_tdm', copie);
    expect(row.section).toBe('imagerie');
    expect(row.section_id).toBe(await sectionId(copie, 'imagerie'));
    // Le lien pointe vers la section DE LA COPIE, jamais vers celle de la source.
    expect(row.section_id).not.toBe(await sectionId(versionId, 'imagerie'));
  });

  test('une version publiee gele ses sections, comme elle gele ses variables', async () => {
    const publiee = await nextDraftVersion();
    // La transition d'etat passe OBLIGATOIREMENT par la RPC, sous une identite reelle :
    // l'ecriture directe du statut est refusee par `guard_template_version_state`.
    await db.asUser(aliceId, (c) => c.query('select public.publish_template_version($1)', [publiee]));

    // Le verrou ne se declenche que pour un utilisateur authentifie (la migration, elle,
    // doit pouvoir reprendre l'existant). On repasse donc par une vraie identite.
    await expect(db.asUser(aliceId, (c) => c.query(
      "update public.template_section set label = 'Interdit' where template_version_id = $1 and section_key = 'clinique'",
      [publiee],
    ))).rejects.toThrow(/immuable/i);
    await expect(db.asUser(aliceId, (c) => c.query(
      `insert into public.template_section (template_version_id, section_key, label, display_order)
       values ($1, 'tardive', 'Tardive', 8)`,
      [publiee],
    ))).rejects.toThrow(/immuable/i);
  });

  test('une section reste modifiable tant que la version est un BROUILLON', async () => {
    // Le pendant du test precedent : le gel doit mordre a la publication, pas avant,
    // sinon on ne pourrait plus construire son formulaire.
    const brouillon = await nextDraftVersion();
    await db.asUser(aliceId, (c) => c.query(
      "update public.template_section set label = 'Clinique revue' where template_version_id = $1 and section_key = 'clinique'",
      [brouillon],
    ));
    const label = (await db.admin.query(
      'select label from public.template_section where template_version_id = $1 and section_key = $2',
      [brouillon, 'clinique'],
    )).rows[0].label;
    expect(label).toBe('Clinique revue');
  });
});

// ---------------------------------------------------------------------------
// 5. Instantane hors-ligne
// ---------------------------------------------------------------------------

describe('instantane hors-ligne', () => {
  test('l instantane emet les sections ET conserve le code sur chaque variable', async () => {
    const snap = (await db.admin.query('select public.download_base_snapshot($1) as s', [baseId])).rows[0].s;
    // `section` reste emis tel quel : c'est ce que lisent les copies deja telechargees.
    expect(snap.fields.every((f: { section?: unknown }) => typeof f.section === 'string')).toBe(true);
    const keys = (snap.sections as { sectionKey: string }[]).map((s) => s.sectionKey);
    expect(keys).toContain('clinique');
    expect(keys).toContain('imagerie');
    // Les patients restent la : une omission ici viderait l'instantane hors-ligne.
    expect(Array.isArray(snap.patients)).toBe(true);
    expect(snap.patients.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Creation d'un jeu de variables complet
// ---------------------------------------------------------------------------

describe('create_template_bundle', () => {
  test('un gabarit cree depuis la bibliotheque recoit les sections de ses variables', async () => {
    // La bibliotheque de gabarits passe par cette RPC en fournissant ses champs. Sans
    // creation des sections, chaque variable arriverait detachee et le constructeur
    // s'ouvrirait sur un unique bloc « Autre ».
    const payload = {
      name: 'Traumatisme cranien',
      specialty: 'neurochirurgie',
      fields: [
        { fieldKey: 'mecanisme', label: 'Mecanisme', scope: 'patient', section: 'circonstances', type: 'text' },
        { fieldKey: 'glasgow', label: 'Glasgow', scope: 'encounter', section: 'examen_initial', type: 'integer' },
        { fieldKey: 'tdm', label: 'TDM', scope: 'encounter', section: 'imagerie', type: 'boolean' },
      ],
    };
    const versionCree = (await db.asUser(aliceId, (c) => c.query(
      'select public.create_template_bundle($1::jsonb, $2) as r',
      [JSON.stringify(payload), '6f9619ff-8b86-d011-b42d-00cf4fc964ff'],
    ))).rows[0].r.versionId;

    // L'ordre est celui de la PREMIERE apparition des codes dans les champs.
    expect((await sectionsOf(versionCree)).map((s) => s.section_key))
      .toEqual(['circonstances', 'examen_initial', 'imagerie']);
    const tdm = await fieldRow('tdm', versionCree);
    expect(tdm.section).toBe('imagerie');
    expect(tdm.section_id).toBe(await sectionId(versionCree, 'imagerie'));
  });

  test('un payload portant des sections EXPLICITES fixe leurs libelles et leur ordre', async () => {
    const payload = {
      name: 'Registre TC ordonne',
      specialty: 'neurochirurgie',
      sections: [
        { key: 'evolution', label: 'Évolution' },
        { key: 'identification', label: 'Identification' },
      ],
      fields: [
        { fieldKey: 'issue', label: 'Issue', scope: 'encounter', section: 'evolution', type: 'text' },
        { fieldKey: 'sexe_tc', label: 'Sexe', scope: 'patient', section: 'identification', type: 'text' },
      ],
    };
    const versionCree = (await db.asUser(aliceId, (c) => c.query(
      'select public.create_template_bundle($1::jsonb, $2) as r',
      [JSON.stringify(payload), '6f9619ff-8b86-d011-b42d-00cf4fc964aa'],
    ))).rows[0].r.versionId;
    expect(await sectionsOf(versionCree)).toEqual([
      { section_key: 'evolution', label: 'Évolution', display_order: 0 },
      { section_key: 'identification', label: 'Identification', display_order: 1 },
    ]);
  });

  test('une section de FORME invalide est refusee avant toute ecriture', async () => {
    await expect(db.asUser(aliceId, (c) => c.query(
      'select public.create_template_bundle($1::jsonb, $2)',
      [JSON.stringify({
        name: 'Refus',
        fields: [{ fieldKey: 'x', label: 'X', scope: 'patient', section: 'Imagerie !', type: 'text' }],
      }), '6f9619ff-8b86-d011-b42d-00cf4fc964bb'],
    ))).rejects.toThrow(/INVALID_FIELD/);
  });

  test('un jeu de variables VIDE demarre sur les trois sections historiques', async () => {
    // Le constructeur ne doit jamais s'ouvrir sans aucun regroupement disponible.
    const versionCree = (await db.asUser(aliceId, (c) => c.query(
      'select public.create_template_bundle($1::jsonb, $2) as r',
      [JSON.stringify({ name: 'Vierge' }), '6f9619ff-8b86-d011-b42d-00cf4fc964cc'],
    ))).rows[0].r.versionId;
    expect((await sectionsOf(versionCree)).map((s) => s.section_key))
      .toEqual(['clinique', 'biologie', 'paraclinique']);
  });
});

// ---------------------------------------------------------------------------
// 7. Suppression en cascade
// ---------------------------------------------------------------------------

describe('suppression d une version et de son gabarit', () => {
  test('supprimer une version brouillon emporte ses sections SANS buter sur la garde', async () => {
    // Piege reel : `template_section` et `template_field` pendent tous deux a la version
    // avec `on delete cascade`, et l'ordre des cascades n'est pas garanti. Si les sections
    // partaient en premier, la garde « section non vide » ferait echouer la suppression
    // d'une version parfaitement legitime.
    const jetable = await nextDraftVersion();
    const avant = (await sectionsOf(jetable)).length;
    expect(avant).toBeGreaterThan(0);
    await db.admin.query('delete from public.template_version where id = $1', [jetable]);
    expect(await sectionsOf(jetable)).toEqual([]);
  });

  test('supprimer un gabarit entier emporte versions, sections et variables', async () => {
    const tpl = (await db.admin.query(
      `insert into public.template (name, specialty, owner_user_id, is_global)
       values ('Jetable L31', null, $1, false) returning id`,
      [aliceId],
    )).rows[0].id;
    const ver = (await db.admin.query(
      `insert into public.template_version (template_id, version_number, status, created_by)
       values ($1, 1, 'draft', $2) returning id`,
      [tpl, aliceId],
    )).rows[0].id;
    await db.admin.query(
      `insert into public.template_section (template_version_id, section_key, label, display_order)
       values ($1, 'imagerie', 'Imagerie', 0)`,
      [ver],
    );
    await addField('l31_jetable', 'imagerie', 0, ver);
    await db.admin.query('delete from public.template where id = $1', [tpl]);
    expect(await sectionsOf(ver)).toEqual([]);
  });
});
