import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startTestDb, type TestDb } from './harness/db.js';

let db: TestDb;

const INDEX_DDL = [
  'create index ix_field_change_log_entity_history on public.field_change_log (entity, entity_id, changed_at desc)',
  'create index ix_export_log_cohort_history on public.export_log (cohort_id, exported_at desc)',
  'create index ix_clinical_attachment_encounter on public.clinical_attachment (encounter_id) where encounter_id is not null',
];

const EXPLAIN_QUERIES = [
  {
    index: 'ix_field_change_log_entity_history',
    sql: `select field_key, old_value, new_value, reason, changed_at
            from public.field_change_log
           where entity='encounter' and entity_id='00000000-0000-0000-0000-000000000001'::uuid
           order by changed_at desc`,
  },
  {
    index: 'ix_export_log_cohort_history',
    sql: `select id, format, exported_at, patient_count, encounter_count, file_hash, stored_file_path
            from public.export_log
           where cohort_id='00000000-0000-0000-0000-000000000001'::uuid
           order by exported_at desc`,
  },
  {
    index: 'ix_clinical_attachment_encounter',
    // Forme de la recherche interne requise par la FK encounter_id ON DELETE SET NULL.
    sql: `select id from public.clinical_attachment
           where encounter_id='00000000-0000-0000-0000-000000000001'::uuid`,
  },
] as const;

async function explain(sql: string): Promise<string> {
  const result = await db.admin.query(`explain (format json) ${sql}`);
  return JSON.stringify(result.rows[0]['QUERY PLAN']);
}

beforeAll(async () => {
  db = await startTestDb();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('indexes fondes sur les chemins de requete reels', () => {
  test('les plans passent de scans sequentiels aux index attendus', async () => {
    const definitions = await db.admin.query(
      `select indexname, indexdef from pg_indexes
        where schemaname='public' and indexname = any($1::text[])`,
      [EXPLAIN_QUERIES.map((query) => query.index)],
    );
    expect(definitions.rows).toHaveLength(3);
    expect(definitions.rows.find((row) => row.indexname === 'ix_field_change_log_entity_history')?.indexdef)
      .toMatch(/\(entity, entity_id, changed_at DESC\)/);
    expect(definitions.rows.find((row) => row.indexname === 'ix_export_log_cohort_history')?.indexdef)
      .toMatch(/\(cohort_id, exported_at DESC\)/);
    expect(definitions.rows.find((row) => row.indexname === 'ix_clinical_attachment_encounter')?.indexdef)
      .toMatch(/WHERE \(encounter_id IS NOT NULL\)/);

    for (const query of EXPLAIN_QUERIES) await db.admin.query(`drop index public.${query.index}`);
    await db.admin.query('set enable_seqscan=off');
    const before = await Promise.all(EXPLAIN_QUERIES.map((query) => explain(query.sql)));
    expect(before.every((plan) => /Seq Scan/.test(plan))).toBe(true);

    for (const ddl of INDEX_DDL) await db.admin.query(ddl);
    const after = await Promise.all(EXPLAIN_QUERIES.map((query) => explain(query.sql)));
    EXPLAIN_QUERIES.forEach((query, index) => {
      expect(after[index]).toContain(query.index);
      expect(after[index]).toMatch(/Index Scan|Bitmap Index Scan/);
    });
  });
});
