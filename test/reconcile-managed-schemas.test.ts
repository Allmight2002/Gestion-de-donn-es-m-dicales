import { describe, expect, test } from 'vitest';
import { splitDumpStatements, buildManagedSchemaPlan } from '../scripts/reconcile-managed-schemas.mjs';

describe('reconciliation des schemas internes', () => {
  test('preserve les corps SQL, les commentaires internes et les quotes', () => {
    const sql = `-- dump\nCREATE OR REPLACE FUNCTION "auth"."f"() RETURNS text AS $body$ BEGIN RETURN 'a;--b'; END; $body$ LANGUAGE plpgsql;\n/* a /* nested */ comment */ GRANT EXECUTE ON FUNCTION "auth"."f"() TO "authenticated";`;
    const parts = splitDumpStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("'a;--b'");
    expect(parts[1]).toMatch(/^GRANT/);
    expect(() => splitDumpStatements('CREATE FUNCTION x AS $$unfinished;')).toThrow();
  });
  test('restaure un trigger personnalise et retire un droit absent de la source', () => {
    const common = 'CREATE TABLE IF NOT EXISTS "auth"."users" ("id" uuid);';
    const pristine = common + ' GRANT SELECT ON TABLE "auth"."users" TO "authenticated";';
    const source = common + ' CREATE OR REPLACE TRIGGER "custom" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."hook"();';
    const plan = buildManagedSchemaPlan(source, pristine);
    expect(plan).toContain('REVOKE SELECT ON TABLE "auth"."users" FROM "authenticated";');
    expect(plan).toContain('CREATE OR REPLACE TRIGGER "custom"');
    expect(plan).not.toContain('CREATE TABLE');
  });
  test('refuse les structures incompatibles avant import', () => {
    expect(() => buildManagedSchemaPlan('CREATE TABLE IF NOT EXISTS "auth"."users" ("id" text);', 'CREATE TABLE IF NOT EXISTS "auth"."users" ("id" uuid);')).toThrow(/incompatibles/);
    expect(() => buildManagedSchemaPlan('DROP SCHEMA "auth" CASCADE;', '')).toThrow(/non prise en charge/);
  });
});
