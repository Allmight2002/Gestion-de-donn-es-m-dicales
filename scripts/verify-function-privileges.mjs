import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_FILE = join(ROOT, 'supabase', 'security-definer-allowlist.json');

export function loadFunctionPrivilegeInventory() {
  const inventory = JSON.parse(readFileSync(INVENTORY_FILE, 'utf8'));
  if (inventory?.version !== 1 || inventory?.schema !== 'public' || inventory?.role !== 'authenticated') {
    throw new Error('Inventaire SECURITY DEFINER invalide.');
  }
  if (!Array.isArray(inventory.categories) || inventory.categories.length === 0) {
    throw new Error('Inventaire SECURITY DEFINER sans categorie.');
  }
  if (String(inventory.serviceRole?.rationale ?? '').trim().length < 40
    || !Array.isArray(inventory.serviceRole?.signatures)
    || inventory.serviceRole.signatures.length === 0) {
    throw new Error('Inventaire SECURITY DEFINER service_role invalide.');
  }
  const signatures = [];
  for (const category of inventory.categories) {
    if (!/^[a-z0-9-]+$/.test(category?.id ?? '') || String(category?.rationale ?? '').trim().length < 40) {
      throw new Error('Categorie SECURITY DEFINER non justifiee.');
    }
    if (!Array.isArray(category.signatures) || category.signatures.length === 0) {
      throw new Error(`Categorie SECURITY DEFINER vide: ${category.id}.`);
    }
    signatures.push(...category.signatures);
  }
  const serviceRoleSignatures = [...inventory.serviceRole.signatures];
  const allSignatures = [...signatures, ...serviceRoleSignatures];
  const duplicates = allSignatures.filter((signature, index) => allSignatures.indexOf(signature) !== index);
  if (duplicates.length > 0) throw new Error(`Signatures SECURITY DEFINER dupliquees: ${duplicates.join(', ')}.`);
  return {
    inventory,
    signatures: signatures.sort(),
    serviceRoleSignatures: serviceRoleSignatures.sort(),
  };
}

export function inspectFunctionPrivileges(rows, schemaPrivileges) {
  const { signatures: expected, serviceRoleSignatures: expectedServiceRole } = loadFunctionPrivilegeInventory();
  const errors = [];
  const anonymous = rows.filter((row) => row.anon_can_execute).map((row) => row.signature);
  if (anonymous.length > 0) errors.push(`${anonymous.length} fonction(s) executable(s) par anon.`);

  const actual = rows
    .filter((row) => row.authenticated_can_execute)
    .map((row) => row.signature)
    .sort();
  const missing = expected.filter((signature) => !actual.includes(signature));
  const unexpected = actual.filter((signature) => !expected.includes(signature));
  if (missing.length > 0) errors.push(`Signatures authenticated manquantes: ${missing.join(', ')}.`);
  if (unexpected.length > 0) errors.push(`Signatures authenticated non inventoriees: ${unexpected.join(', ')}.`);

  const actualServiceRole = rows
    // Sur les projets Supabase hébergés, service_role peut hériter implicitement de
    // l'exécution de fonctions internes. L'inventaire Edge porte uniquement sur les
    // GRANT explicites versionnés, pas sur ce pouvoir d'administration implicite.
    .filter((row) => row.service_role_explicit_execute && !row.authenticated_can_execute)
    .map((row) => row.signature)
    .sort();
  const missingServiceRole = expectedServiceRole.filter((signature) => !actualServiceRole.includes(signature));
  const unexpectedServiceRole = actualServiceRole.filter((signature) => !expectedServiceRole.includes(signature));
  if (missingServiceRole.length > 0) {
    errors.push(`Signatures service_role manquantes ou exposees a authenticated: ${missingServiceRole.join(', ')}.`);
  }
  if (unexpectedServiceRole.length > 0) {
    errors.push(`Signatures service_role exclusives non inventoriees: ${unexpectedServiceRole.join(', ')}.`);
  }

  for (const row of rows) {
    const setting = row.config?.find((entry) => entry.startsWith('search_path='));
    const schemas = setting?.slice('search_path='.length).split(',').map((value) => value.trim()) ?? [];
    if (schemas.length === 0 || schemas.at(-1) !== 'pg_temp') {
      errors.push(`${row.signature}: search_path ne termine pas par pg_temp.`);
    }
    if (schemas.some((schema) => !['public', 'extensions', 'pg_catalog', 'pg_temp'].includes(schema))) {
      errors.push(`${row.signature}: schema non approuve dans search_path.`);
    }
  }
  if (schemaPrivileges.anon_can_create || schemaPrivileges.authenticated_can_create) {
    errors.push('Le schema public est modifiable par anon ou authenticated.');
  }
  return errors;
}

export async function verifyFunctionPrivileges(dbUrl) {
  if (!/^postgres(?:ql)?:\/\//i.test(dbUrl ?? '')) {
    throw new Error('SUPABASE_DB_URL PostgreSQL est requis.');
  }
  const client = new pg.Client({
    connectionString: dbUrl,
    connectionTimeoutMillis: 15_000,
    query_timeout: 30_000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(`
      select
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
        p.proconfig as config,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute,
        exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where acl.grantee = (select oid from pg_roles where rolname = 'service_role')
            and acl.privilege_type = 'EXECUTE'
        ) as service_role_explicit_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
      order by 1
    `);
    const privileges = await client.query(`
      select
        has_schema_privilege('anon', 'public', 'CREATE') as anon_can_create,
        has_schema_privilege('authenticated', 'public', 'CREATE') as authenticated_can_create
    `);
    const errors = inspectFunctionPrivileges(rows, privileges.rows[0]);
    if (errors.length > 0) throw new Error(errors.join(' '));
    return rows.length;
  } finally {
    await client.end().catch(() => {});
  }
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (invokedDirectly) {
  try {
    const count = await verifyFunctionPrivileges(process.env.SUPABASE_DB_URL);
    console.log(`ACL SECURITY DEFINER conformes (${count} fonctions controlees).`);
  } catch (error) {
    console.error(`ACL SECURITY DEFINER non conformes: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
