import { parse } from 'libpg-query';
import { splitDumpStatements } from './reconcile-managed-schemas.mjs';

// A fresh Supabase instance grants defaults when objects are created. Restore
// PostgreSQL's base ACLs, then replay the source's explicit ACLs in one transaction.
export function publicSchemaAccessSql(sourceSql) {
  const access = splitDumpStatements(sourceSql).filter((s) => /^(GRANT |REVOKE |ALTER DEFAULT PRIVILEGES )/.test(s));
  return `DO $meddata_acl$
DECLARE obj record; privilege record; target_role text;
BEGIN
  FOR obj IN SELECT c.oid, c.relowner AS owner, c.relacl AS acl, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')
  LOOP
    FOR privilege IN SELECT DISTINCT grantee FROM aclexplode(obj.acl) WHERE grantee<>obj.owner LOOP
      target_role := CASE WHEN privilege.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END;
      EXECUTE format('REVOKE ALL PRIVILEGES ON %s %s FROM %s CASCADE',
        CASE WHEN obj.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END, obj.oid::regclass, target_role);
    END LOOP;
  END LOOP;
  FOR obj IN SELECT p.oid, p.proowner AS owner, p.proacl AS acl, p.prokind
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  LOOP
    FOR privilege IN SELECT DISTINCT grantee FROM aclexplode(obj.acl) WHERE grantee<>obj.owner LOOP
      target_role := CASE WHEN privilege.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END;
      EXECUTE format('REVOKE ALL PRIVILEGES ON %s %s FROM %s CASCADE',
        CASE WHEN obj.prokind='p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, obj.oid::regprocedure, target_role);
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON %s %s TO PUBLIC',
      CASE WHEN obj.prokind='p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, obj.oid::regprocedure);
  END LOOP;
END $meddata_acl$;

${access.join('\n\n')}
`;
}

function normalizedNode(value) {
  if (Array.isArray(value)) return value.map(normalizedNode);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!['location', 'stmt_location', 'stmt_len'].includes(key)) result[key] = normalizedNode(value[key]);
  }
  if (result.BoolExpr?.args && ['AND_EXPR', 'OR_EXPR'].includes(result.BoolExpr.boolop)) {
    const { boolop } = result.BoolExpr;
    result.BoolExpr.args = result.BoolExpr.args.flatMap((arg) => arg.BoolExpr?.boolop === boolop ? arg.BoolExpr.args : [arg]);
  }
  return result;
}

export async function canonicalDumpStatements(sql) {
  const tree = await parse(sql);
  return tree.stmts.map((statement) => JSON.stringify(normalizedNode(statement.stmt))).sort();
}
