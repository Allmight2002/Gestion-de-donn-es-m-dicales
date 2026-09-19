// Test DB de la RPC base_activity_log (feature C3) : journal d'activite LISIBLE d'une base pour
// ses collaborateurs, avec le nom de l'auteur, en EXCLUANT les lectures sensibles (E1).
// On seme les evenements DIRECTEMENT dans audit_log (contexte admin) : le test reste ainsi
// independant du modele d'ecriture d'acces/import (qui evolue par ailleurs).
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import type { Client } from 'pg';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;
let aliceId: string; // proprietaire (a acces a la base)
let editorId: string; // collaborateur ordinaire de la base
let adminId: string; // system_admin : aucun acces a la base
let baseId: string;

const rowsAs = (uid: string, sql: string, params?: unknown[]) =>
  db.asUser(uid, async (c: Client) => (await c.query(sql, params)).rows);

const seedEvent = (action: string, metadata: Record<string, unknown> = {}, createdAt?: string) =>
  db.admin.query(
    "insert into public.audit_log(user_id, action, entity, entity_id, base_id, metadata, created_at) values($1,$2,'base',$3,$3,$4::jsonb, coalesce($5::timestamptz, now())) returning id",
    [aliceId, action, baseId, JSON.stringify(metadata), createdAt ?? null],
  );

beforeAll(async () => {
  db = await startTestDb({ seed: true });
  const byEmail = new Map<string, string>(
    (await db.admin.query('select email, id from auth.users')).rows.map((r) => [r.email, r.id]),
  );
  aliceId = byEmail.get('alice@demo.test')!;
  editorId = byEmail.get('editor@demo.test')!;
  adminId = byEmail.get('admin@demo.test')!;
  baseId = (await db.admin.query('select id from public.base limit 1')).rows[0].id;
}, 180_000);

afterAll(async () => { await db?.stop(); });

describe('C3 base_activity_log (journal d activite lisible)', () => {
  test('un collaborateur voit l activite (nom auteur) ; lectures d identite EXCLUES ; sans acces refuse', async () => {
    await seedEvent('access_granted'); // activite generale -> visible
    await seedEvent('identity_read');  // lecture sensible -> EXCLUE (a sa vue dediee E1)

    const log = (await rowsAs(aliceId, 'select public.base_activity_log($1) as a', [baseId]))[0].a as
      { action: string; actorName: string }[];
    expect(log.some((e) => e.action === 'access_granted')).toBe(true);
    expect(log.some((e) => e.action === 'identity_read')).toBe(false);
    expect(log.every((e) => typeof e.actorName === 'string' && e.actorName.length > 0)).toBe(true);

    // Un compte SANS acces a la base (admin systeme) est refuse.
    await expect(rowsAs(adminId, 'select public.base_activity_log($1) as a', [baseId])).rejects.toThrow(/refus|denied|acces/i);
  });

  test('les metadonnees publiques sont minimisees pour les collaborateurs', async () => {
    await seedEvent('invitation_created', {
      invited_email: 'secret.person@example.org',
      access_role: 'editor',
      user_id: '00000000-0000-0000-0000-000000000001',
    });
    await seedEvent('patient_deleted', { reason: 'motif confidentiel', patient_id: '00000000-0000-0000-0000-000000000002' });

    const log = (await rowsAs(editorId, 'select public.base_activity_log($1) as a', [baseId]))[0].a as
      { action: string; metadata: Record<string, unknown> }[];

    const invitation = log.find((e) => e.action === 'invitation_created')!;
    expect(invitation.metadata).toMatchObject({ access_role: 'editor' });
    expect(JSON.stringify(invitation.metadata)).not.toContain('secret.person@example.org');
    expect(JSON.stringify(invitation.metadata)).not.toContain('00000000-0000-0000-0000-000000000001');

    const deletionForEditor = log.find((e) => e.action === 'patient_deleted')!;
    expect(deletionForEditor.metadata).not.toHaveProperty('reason');
    expect(JSON.stringify(deletionForEditor.metadata)).not.toContain('00000000-0000-0000-0000-000000000002');

    const ownerLog = (await rowsAs(aliceId, 'select public.base_activity_log($1) as a', [baseId]))[0].a as
      { action: string; metadata: Record<string, unknown> }[];
    expect(ownerLog.find((e) => e.action === 'patient_deleted')?.metadata).toMatchObject({ reason: 'motif confidentiel' });
  });

  // E6 — l'evolution du formulaire doit etre LISIBLE dans l'historique : qui, quand, quel
  // impact, vers quelle revision. Les compteurs et la classification viennent de l'instantane
  // que `apply_form_preparation` a fige dans `audit_log.metadata` ; rien n'est relu dans la
  // version de gabarit vivante, qui pourrait avoir change depuis.
  test('une evolution du formulaire expose auteur, revision et impact, sans pointeur vivant', async () => {
    await seedEvent('form_preparation_applied', {
      operation_id: '00000000-0000-0000-0000-0000000000aa',
      source_template_version_id: '00000000-0000-0000-0000-0000000000b1',
      target_template_version_id: '00000000-0000-0000-0000-0000000000b2',
      source_revision: 4,
      target_revision: 5,
      classification: 'additive',
      impact: {
        serverCounts: { patients: 12, encounters: 30 },
        addedFields: [
          { fieldKey: 'date_debut_symptomes', scope: 'encounter', required: false, potentiallyAffectedRecords: 30 },
          { fieldKey: 'poids_admission', scope: 'patient', required: true, potentiallyAffectedRecords: 12 },
        ],
        addedSections: [{ sectionKey: 'suivi', parentSectionKey: null }],
        addedRules: [],
        addedDiagnosisAssociations: [{ scope: 'encounter', diagnosisFieldKey: 'diagnostic' }],
      },
    });

    const editorLog = (await rowsAs(editorId, 'select public.base_activity_log($1) as a', [baseId]))[0].a as
      { action: string; actorName: string; at: string; metadata: Record<string, unknown> }[];
    const evolution = editorLog.find((e) => e.action === 'form_preparation_applied')!;

    expect(typeof evolution.actorName).toBe('string');
    expect(evolution.actorName.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(evolution.at))).toBe(false);
    expect(evolution.metadata).toMatchObject({
      classification: 'additive',
      source_revision: 4,
      target_revision: 5,
      added_fields: 2,
      added_required_fields: 1,
      added_sections: 1,
      added_diagnosis_associations: 1,
      affected_patients: 12,
      affected_encounters: 30,
    });
    // Un collaborateur voit l'ampleur, pas la structure nominative ajoutee.
    expect(evolution.metadata).not.toHaveProperty('added_field_keys');
    // Et jamais l'identifiant technique d'une version de gabarit : c'est le numero de revision
    // qui fait foi dans l'historique, pas un pointeur vers un objet qui peut changer.
    expect(JSON.stringify(evolution.metadata)).not.toContain('00000000-0000-0000-0000-0000000000b2');

    const ownerLog = (await rowsAs(aliceId, 'select public.base_activity_log($1) as a', [baseId]))[0].a as
      { action: string; metadata: Record<string, unknown> }[];
    const ownerEvolution = ownerLog.find((e) => e.action === 'form_preparation_applied')!;
    expect(ownerEvolution.metadata.added_field_keys).toEqual(['date_debut_symptomes', 'poids_admission']);
  });

  // E5/E6 — le proprietaire dispense de motif reste audite : auteur, date, base, operation. Le
  // journal ne doit NI afficher un motif absent, NI en fabriquer un.
  test('une operation du proprietaire sans motif reste auditee sans motif invente', async () => {
    await seedEvent('patient_deleted', { patient_id: '00000000-0000-0000-0000-0000000000c1' });

    const ownerLog = (await rowsAs(aliceId, 'select public.base_activity_log($1) as a', [baseId]))[0].a as
      { action: string; actorName: string; at: string; metadata: Record<string, unknown> }[];
    const sansMotif = ownerLog
      .filter((e) => e.action === 'patient_deleted')
      .find((e) => !('reason' in e.metadata))!;

    expect(sansMotif).toBeDefined();
    expect(sansMotif.actorName.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(sansMotif.at))).toBe(false);
    expect(Object.keys(sansMotif.metadata)).toEqual([]);
  });

  test('le journal est pagine et filtrable par action', async () => {
    await seedEvent('pagination_probe', {}, '2026-07-04T12:00:00.000Z');
    await seedEvent('export_created', { format: 'csv' }, '2026-07-04T11:30:00.000Z');
    await seedEvent('pagination_probe', {}, '2026-07-04T11:00:00.000Z');

    const firstPage = (await rowsAs(
      aliceId,
      'select public.base_activity_log($1, null, 1, $2) as a',
      [baseId, 'pagination_probe'],
    ))[0].a as { id: string; at: string; action: string }[];
    expect(firstPage).toHaveLength(1);
    expect(firstPage[0].action).toBe('pagination_probe');
    expect(new Date(firstPage[0].at).toISOString()).toBe('2026-07-04T12:00:00.000Z');

    const nextPage = (await rowsAs(
      aliceId,
      'select public.base_activity_log($1, $2::timestamptz, 10, $3) as a',
      [baseId, firstPage[0].at, 'pagination_probe'],
    ))[0].a as { id: string; at: string; action: string }[];
    expect(nextPage).toHaveLength(1);
    expect(nextPage[0].action).toBe('pagination_probe');
    expect(new Date(nextPage[0].at).toISOString()).toBe('2026-07-04T11:00:00.000Z');
  });

  test('la pagination conserve les evenements partageant exactement le meme timestamp', async () => {
    await seedEvent('same_timestamp_probe', {}, '2026-07-04T13:00:00.000Z');
    await seedEvent('same_timestamp_probe', {}, '2026-07-04T13:00:00.000Z');

    const firstPage = (await rowsAs(
      aliceId,
      'select public.base_activity_log($1, null, 1, $2) as a',
      [baseId, 'same_timestamp_probe'],
    ))[0].a as { id: string; at: string; action: string }[];
    expect(firstPage).toHaveLength(1);

    const nextPage = (await rowsAs(
      aliceId,
      'select public.base_activity_log($1, $2::timestamptz, 1, $3, $4::uuid) as a',
      [baseId, firstPage[0].at, 'same_timestamp_probe', firstPage[0].id],
    ))[0].a as { id: string; at: string; action: string }[];
    expect(nextPage).toHaveLength(1);
    expect(nextPage[0].id).not.toBe(firstPage[0].id);
    expect(new Date(nextPage[0].at).toISOString()).toBe('2026-07-04T13:00:00.000Z');
  });
});
