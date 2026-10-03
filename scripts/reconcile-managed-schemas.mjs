// Reconcile authenticated pg_dump schema exports with a pristine, same-version
// instance. Refuse unsupported structural drift before any target write.
export function splitDumpStatements(sql) {
  const statements = [];
  let statement = '', quote = null, dollar = null, block = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i], next = sql[i + 1];
    if (dollar) {
      if (sql.startsWith(dollar, i)) { statement += dollar; i += dollar.length - 1; dollar = null; }
      else statement += c;
    } else if (quote) {
      statement += c;
      if (c === quote) {
        if (next === quote) { statement += next; i += 1; } else quote = null;
      } else if (c === '\\' && quote === "'") { statement += next ?? ''; i += 1; }
    } else if (block) {
      if (c === '/' && next === '*') { block += 1; i += 1; }
      else if (c === '*' && next === '/') { block -= 1; i += 1; }
    } else if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; statement += '\n';
    } else if (c === '/' && next === '*') { block = 1; i += 1; statement += ' '; }
    else if (c === "'" || c === '"') { quote = c; statement += c; }
    else if (c === '$' && /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.test(sql.slice(i))) {
      dollar = /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(sql.slice(i))[0];
      statement += dollar; i += dollar.length - 1;
    } else if (c === ';') {
      if (statement.trim()) statements.push(`${statement.trim()};`);
      statement = '';
    } else statement += c;
  }
  if (quote || dollar || block || statement.trim()) throw new Error('Export de schema incomplet.');
  if (statements.some((s) => /^\\/m.test(s))) throw new Error('Commande psql inattendue.');
  return statements;
}

function reverseAccess(statement) {
  const grant = /^((?:ALTER DEFAULT PRIVILEGES [^;]+? )?)GRANT (.+) TO (.+?)(?: WITH GRANT OPTION)?;$/s.exec(statement);
  if (grant) return `${grant[1] ?? ''}REVOKE ${grant[2]} FROM ${grant[3]};`;
  const revoke = /^((?:ALTER DEFAULT PRIVILEGES [^;]+? )?)REVOKE (.+) FROM (.+);$/s.exec(statement);
  if (revoke) return `${revoke[1] ?? ''}GRANT ${revoke[2]} TO ${revoke[3]};`;
  return null;
}

export function buildManagedSchemaPlan(sourceSql, pristineSql) {
  const source = splitDumpStatements(sourceSql), pristine = splitDumpStatements(pristineSql);
  const sourceSet = new Set(source), pristineSet = new Set(pristine);
  const plan = [];
  for (const statement of pristine) {
    if (sourceSet.has(statement)) continue;
    const reverse = reverseAccess(statement);
    if (reverse) { plan.push(reverse); continue; }
    if (/^ALTER (?:TABLE|FUNCTION|SCHEMA|SEQUENCE|TYPE) .* OWNER TO /s.test(statement)) continue;
    if (/^COMMENT ON /s.test(statement)) { plan.push(statement.replace(/ IS .*;$/s, ' IS NULL;')); continue; }
    throw new Error('Versions ou structures internes incompatibles; restauration refusee avant ecriture.');
  }
  for (const statement of source) {
    if (pristineSet.has(statement)) continue;
    if (!/^(?:CREATE (?:OR REPLACE )?(?:FUNCTION|TRIGGER|POLICY|INDEX|UNIQUE INDEX|TYPE|TABLE IF NOT EXISTS|SEQUENCE IF NOT EXISTS)|ALTER (?:TABLE|FUNCTION|SCHEMA|SEQUENCE|TYPE|DEFAULT PRIVILEGES)|GRANT |REVOKE |COMMENT ON )/s.test(statement)) {
      throw new Error('Definition interne non prise en charge; reconciliation manuelle requise.');
    }
    plan.push(statement);
  }
  // Dumps restore session configuration; include it explicitly for custom SQL.
  return ['SET check_function_bodies = false;', "SELECT pg_catalog.set_config('search_path', '', false);", ...plan].join('\n\n');
}
