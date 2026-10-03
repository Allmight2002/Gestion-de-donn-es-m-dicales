import { expect, test } from 'vitest';
import { canonicalDumpStatements, publicSchemaAccessSql } from '../scripts/public-schema-access.mjs';

test('ignore les parentheses booleennes equivalentes mais detecte un droit ou une contrainte differente', async () => {
  const a = 'CREATE TABLE x (a integer CHECK (a > 0 AND (a < 10 AND a <> 5)));';
  const b = 'CREATE TABLE x (a integer CHECK ((a > 0 AND a < 10) AND a <> 5));';
  expect(await canonicalDumpStatements(a)).toEqual(await canonicalDumpStatements(b));
  expect(await canonicalDumpStatements(a)).not.toEqual(await canonicalDumpStatements(a.replace('a < 10', 'a < 20')));
  expect(await canonicalDumpStatements('GRANT SELECT ON TABLE x TO anon;')).not.toEqual(await canonicalDumpStatements('GRANT ALL ON TABLE x TO anon;'));
});

test('rejoue les ACL source apres suppression des droits automatiques de la cible', () => {
  const plan = publicSchemaAccessSql('CREATE TABLE x (a integer); REVOKE ALL ON TABLE x FROM anon; GRANT SELECT ON TABLE x TO authenticated;');
  expect(plan.indexOf('REVOKE ALL PRIVILEGES')).toBeLessThan(plan.indexOf('GRANT SELECT ON TABLE x TO authenticated;'));
  expect(plan).toContain('REVOKE ALL ON TABLE x FROM anon;');
  expect(plan).not.toContain('CREATE TABLE x');
});
