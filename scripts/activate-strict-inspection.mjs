// Dernier interrupteur de la release stricte : prouve le scanner, puis active la politique DB.
// Ne jamais lancer avant le deploiement des Edge Functions et du frontend strict.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSupabaseTarget } from './check-supabase-target.mjs';

const clean = (value) => value?.trim() ?? '';
const EICAR = [
  'X5O!P%@AP[4',
  String.fromCharCode(92),
  'PZX54(P^)7CC)7}',
  '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
].join('');

class SafeActivationError extends Error {}

function scannerHealthUrl(scanUrl) {
  const url = new URL(scanUrl);
  if (url.protocol !== 'https:' || !/\/scan\/?$/.test(url.pathname)) {
    throw new SafeActivationError('CLAMAV_SCAN_URL doit etre une URL HTTPS terminee par /scan.');
  }
  url.pathname = url.pathname.replace(/\/scan\/?$/, '/health');
  return url;
}

async function jsonResponse(response, label) {
  if (!response.ok) throw new SafeActivationError(`${label}: HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new SafeActivationError(`${label}: reponse JSON invalide.`);
  }
}

export async function verifyStrictScanner({ scanUrl, token, fetchImpl = fetch }) {
  const normalizedToken = clean(token);
  if (normalizedToken.length < 32 || ['change-me', 'changeme'].includes(normalizedToken.toLowerCase())) {
    throw new SafeActivationError('CLAMAV_SCAN_TOKEN est absent, trop court ou utilise une valeur par defaut.');
  }

  try {
    const health = await jsonResponse(
      await fetchImpl(scannerHealthUrl(scanUrl), { signal: AbortSignal.timeout(20_000) }),
      'Sante scanner',
    );
    if (health.status !== 'ok') throw new SafeActivationError('Sante scanner: clamd ne repond pas OK.');

    const scan = async (bytes, label) => jsonResponse(
      await fetchImpl(scanUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${normalizedToken}`,
          'content-type': 'application/octet-stream',
        },
        body: bytes,
        signal: AbortSignal.timeout(30_000),
      }),
      label,
    );

    const cleanVerdict = await scan(Buffer.from('MEDDATA-STAGING-SYNTHETIC-CLEAN-FILE'), 'Scan fichier sain');
    if (cleanVerdict.status !== 'clean' || cleanVerdict.engine !== 'clamav') {
      throw new SafeActivationError('Scan fichier sain: verdict ClamAV clean attendu.');
    }

    const infectedVerdict = await scan(Buffer.from(EICAR), 'Scan EICAR isole');
    if (infectedVerdict.status !== 'infected' || !/eicar/i.test(String(infectedVerdict.signature ?? ''))) {
      throw new SafeActivationError('Scan EICAR isole: verdict infected EICAR attendu.');
    }
  } catch (error) {
    if (error instanceof SafeActivationError) throw error;
    throw new SafeActivationError('Scanner strict injoignable ou reponse inexploitable.');
  }
}

async function defaultCreateClient(dbUrl) {
  const { default: pg } = await import('pg');
  return new pg.Client({ connectionString: dbUrl });
}

export async function activateStrictInspection({ dbUrl, createClient = defaultCreateClient }) {
  if (!/^postgres(ql)?:\/\//i.test(clean(dbUrl))) {
    throw new SafeActivationError('SUPABASE_DB_URL doit etre une URL PostgreSQL.');
  }

  const client = await createClient(dbUrl);
  let transactionStarted = false;
  try {
    await client.connect();
    await client.query('begin');
    transactionStarted = true;
    await client.query("select pg_advisory_xact_lock(hashtextextended('meddata.strict_inspection.activation', 0))");
    const updated = await client.query(
      "update public.app_security_setting set value = 'true', updated_at = now() where key = 'require_server_inspection' returning key",
    );
    if (updated.rowCount !== 1) throw new SafeActivationError('La configuration DB require_server_inspection est absente ou ambigue.');
    const verified = await client.query('select public.require_server_inspection() as strict');
    if (verified.rows[0]?.strict !== true) throw new SafeActivationError('La base ne confirme pas le mode strict apres mise a jour.');
    await client.query('commit');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) await client.query('rollback').catch(() => {});
    if (error instanceof SafeActivationError) throw error;
    throw new SafeActivationError('Activation transactionnelle du mode strict impossible.');
  } finally {
    await client.end().catch(() => {});
  }
}

export async function runStrictActivation({ target, env = process.env }) {
  if (!['staging', 'production'].includes(target)) {
    throw new SafeActivationError('--target=staging ou --target=production est requis.');
  }
  const targetErrors = validateSupabaseTarget({ target, env });
  if (targetErrors.length) throw new SafeActivationError(targetErrors.join(' '));
  for (const name of ['VITE_USE_SIGNED_READ', 'VITE_REQUIRE_SERVER_INSPECTION', 'REQUIRE_SERVER_INSPECTION', 'DB_REQUIRE_SERVER_INSPECTION']) {
    if (env[name] !== 'true') throw new SafeActivationError(`${name}=true est requis avant l activation DB.`);
  }

  await verifyStrictScanner({ scanUrl: clean(env.CLAMAV_SCAN_URL), token: clean(env.CLAMAV_SCAN_TOKEN) });
  console.log('Scanner strict OK: sante, fichier synthetique sain et EICAR isole.');
  await activateStrictInspection({ dbUrl: clean(env.SUPABASE_DB_URL) });
  console.log(`Mode strict DB ${target}: active et verifie.`);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const target = process.argv.find((arg) => arg.startsWith('--target='))?.slice(9) ?? '';
  try {
    await runStrictActivation({ target });
  } catch (error) {
    const message = error instanceof SafeActivationError ? error.message : 'Activation stricte interrompue.';
    console.error(`Activation stricte refusee: ${message}`);
    process.exit(1);
  }
}
