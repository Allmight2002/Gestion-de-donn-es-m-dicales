// Test DB du champ de terminologie (feature T2) : ce qui entre dans la donnee doit etre un
// couple code + libelle COHERENT avec le referentiel actif. Les chemins de refus comptent
// autant que le chemin nominal : c'est eux qui empechent une fiche de mentir sur elle-meme.
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let versionId: string;
let releaseId: string;

/** Appelle la validation serveur avec une valeur pour le champ `diagnostic`. */
const validate = (value: unknown, fieldKey = 'diagnostic') =>
  db.admin.query('select public.assert_data_valid($1, $2, $3::jsonb)', [
    versionId, 'encounter', JSON.stringify({ [fieldKey]: value }),
  ]);

beforeAll(async () => {
  db = await startTestDb({ seed: true });

  releaseId = (await db.admin.query(
    `insert into public.terminology_release(slug, title, source, version, is_active, imported_at)
     values('test-t2', 'Referentiel T2', 'test', '1', true, now()) returning id`,
  )).rows[0].id;
  await db.admin.query(
    `insert into public.terminology_concept(release_id, code, label, kind, is_selectable) values
       ($1, '1A00', 'Cholera', 'category', true),
       ($1, '5A11', 'Diabete sucre de type 2', 'category', true),
       ($1, 'BLK1', 'Maladies infectieuses', 'block', false)`,
    [releaseId],
  );

  versionId = (await db.admin.query('select id from public.template_version limit 1')).rows[0].id;
  await db.admin.query(
    `insert into public.template_field(template_version_id, field_key, label, scope, section, type, required, display_order, allow_missing_codes)
     values($1, 'diagnostic', 'Diagnostic', 'encounter', 'clinique', 'terminology', false, 900, false),
           ($1, 'diagnostic_opt', 'Diagnostic facultatif', 'encounter', 'clinique', 'terminology', false, 901, true)`,
    [versionId],
  );
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('T2 champ de terminologie', () => {
  test('le type terminology est desormais accepte par la contrainte de table', async () => {
    const row = (await db.admin.query(
      `select type from public.template_field where template_version_id = $1 and field_key = 'diagnostic'`,
      [versionId],
    )).rows[0];
    expect(row.type).toBe('terminology');
  });

  test('un couple code et libelle conforme est accepte', async () => {
    await expect(validate({ code: '1A00', label: 'Cholera' })).resolves.toBeDefined();
    await expect(validate({ code: '5A11', label: 'Diabete sucre de type 2' })).resolves.toBeDefined();
  });

  test('un code inconnu du referentiel est refuse', async () => {
    await expect(validate({ code: 'ZZ99', label: 'Maladie inventee' })).rejects.toThrow(/inconnu|conforme/i);
  });

  // Le coeur du controle : sans lui, une fiche afficherait un libelle sans rapport avec le
  // code sur lequel les statistiques comptent.
  test('un code valide accompagne d un autre libelle est refuse', async () => {
    await expect(validate({ code: '1A00', label: 'Diabete sucre de type 2' })).rejects.toThrow(/inconnu|conforme/i);
    await expect(validate({ code: '1A00', label: 'Cholera grave' })).rejects.toThrow(/inconnu|conforme/i);
  });

  test('un regroupement non selectionnable ne peut pas etre saisi', async () => {
    await expect(validate({ code: 'BLK1', label: 'Maladies infectieuses' })).rejects.toThrow(/inconnu|conforme/i);
  });

  test('une cle surnumeraire est refusee', async () => {
    await expect(validate({ code: '1A00', label: 'Cholera', note: 'contrebande' }))
      .rejects.toThrow(/inattendu/i);
  });

  test('un code ou un libelle vide est refuse', async () => {
    await expect(validate({ code: '', label: 'Cholera' })).rejects.toThrow(/requis/i);
    await expect(validate({ code: '1A00', label: '   ' })).rejects.toThrow(/requis/i);
    await expect(validate({ code: '1A00' })).rejects.toThrow(/requis/i);
  });

  test('un texte simple ne suffit pas pour un champ de terminologie', async () => {
    await expect(validate('Cholera')).rejects.toThrow(/attendus/i);
    await expect(validate(['1A00'])).rejects.toThrow(/attendus/i);
    await expect(validate({ code: 1, label: 2 })).rejects.toThrow(/requis/i);
  });

  // Les codes de donnee manquante restent traites en amont, comme pour tout autre type.
  test('une valeur manquante codifiee suit la regle du champ', async () => {
    await expect(validate({ __missing__: 'inconnu' }, 'diagnostic_opt')).resolves.toBeDefined();
    await expect(validate({ __missing__: 'inconnu' })).rejects.toThrow(/manquante non autorisee/i);
  });

  test('un champ absent ou nul reste licite', async () => {
    await expect(db.admin.query(
      `select public.assert_data_valid($1, 'encounter', '{}'::jsonb)`, [versionId],
    )).resolves.toBeDefined();
    await expect(validate(null)).resolves.toBeDefined();
  });

  // Le referentiel actif est la reference : un concept d'une publication retiree du service
  // ne doit plus pouvoir entrer dans une donnee.
  test('un concept d un referentiel inactif est refuse', async () => {
    await db.admin.query('update public.terminology_release set is_active = false where id = $1', [releaseId]);
    try {
      await expect(validate({ code: '1A00', label: 'Cholera' })).rejects.toThrow(/inconnu|conforme/i);
    } finally {
      await db.admin.query('update public.terminology_release set is_active = true where id = $1', [releaseId]);
    }
  });

  test('les autres types de champ ne sont pas affectes', async () => {
    await db.admin.query(
      `insert into public.template_field(template_version_id, field_key, label, scope, section, type, required, display_order, allowed_values, allow_missing_codes)
       values($1, 'issue', 'Issue', 'encounter', 'clinique', 'select', false, 902, '["Domicile","Transfert"]'::jsonb, false)`,
      [versionId],
    );
    await expect(validate('Domicile', 'issue')).resolves.toBeDefined();
    await expect(validate('Ailleurs', 'issue')).rejects.toThrow(/non autorisee/i);
    await expect(validate({ code: '1A00', label: 'Cholera' }, 'issue')).rejects.toThrow(/Texte JSON attendu/i);
  });
});
