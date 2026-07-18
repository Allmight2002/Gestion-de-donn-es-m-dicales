import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAGING_PROJECT_REF,
  projectRefFromSupabaseUrl,
} from './check-supabase-target.mjs';
import { vercelCookieHeaderFromStorageState } from './vercel-cookie-state.mjs';

const REQUEST_TIMEOUT_MS = 15_000;
const RETRIES = 2;
const clean = (value) => value?.trim() ?? '';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function required(env, name) {
  const value = clean(env[name]);
  if (!value) throw new Error(`${name} est requis.`);
  return value;
}

function httpsUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} doit etre une URL valide.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`${name} doit etre une URL HTTPS sans identifiants ni fragment.`);
  }
  return url;
}

export function healthUrlForScan(value) {
  const url = httpsUrl(value, 'CLAMAV_SCAN_URL');
  if (!/\/scan\/?$/.test(url.pathname)) {
    throw new Error('CLAMAV_SCAN_URL doit se terminer par /scan.');
  }
  url.pathname = url.pathname.replace(/\/scan\/?$/, '/health');
  url.search = '';
  return url.toString();
}

export function validateMonitorConfiguration(env = process.env) {
  const target = required(env, 'MONITOR_TARGET');
  if (!['staging', 'production'].includes(target)) {
    throw new Error('MONITOR_TARGET doit valoir staging ou production.');
  }
  const projectRef = required(env, 'SUPABASE_PROJECT_REF').toLowerCase();
  const supabaseUrl = httpsUrl(required(env, 'SUPABASE_URL'), 'SUPABASE_URL').toString().replace(/\/$/, '');
  if (!/^[a-z0-9]{20}$/.test(projectRef) || projectRefFromSupabaseUrl(supabaseUrl) !== projectRef) {
    throw new Error('SUPABASE_URL et SUPABASE_PROJECT_REF sont divergents.');
  }
  if (target === 'staging' && projectRef !== STAGING_PROJECT_REF) {
    throw new Error('Le moniteur staging ne cible pas le projet staging approuve.');
  }
  const anonKey = required(env, 'SUPABASE_ANON_KEY');
  if (anonKey.length < 20 || /service_role|sb_secret_/i.test(anonKey)) {
    throw new Error('SUPABASE_ANON_KEY est invalide ou contient une cle serveur.');
  }
  const scanUrl = httpsUrl(required(env, 'CLAMAV_SCAN_URL'), 'CLAMAV_SCAN_URL').toString();
  const scanToken = required(env, 'CLAMAV_SCAN_TOKEN');
  if (scanToken.length < 32 || /change-me|changeme|placeholder/i.test(scanToken)) {
    throw new Error('CLAMAV_SCAN_TOKEN est absent ou utilise une valeur par defaut.');
  }
  if (required(env, 'MONITOR_REQUIRE_STRICT_INSPECTION') !== 'true') {
    throw new Error('MONITOR_REQUIRE_STRICT_INSPECTION doit valoir true.');
  }
  return {
    target,
    projectRef,
    appUrl: httpsUrl(required(env, 'MONITOR_APP_URL'), 'MONITOR_APP_URL').toString(),
    supabaseUrl,
    anonKey,
    scanUrl,
    scanToken,
    frontendStorageStatePath: clean(env.MONITOR_FRONTEND_STORAGE_STATE) || null,
  };
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function boundedFetch(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status < 500 || attempt === RETRIES) return response;
    } catch (error) {
      lastError = error;
      if (attempt === RETRIES) break;
    }
    await delay(500 * attempt);
  }
  throw new Error(lastError instanceof Error && lastError.name === 'TimeoutError'
    ? 'timeout'
    : 'network');
}

async function body(response) {
  const text = await response.text();
  if (text.length > 64 * 1024) throw new Error('response-too-large');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function runCheck(name, operation) {
  const started = performance.now();
  try {
    const status = await operation();
    return {
      name,
      ok: true,
      httpStatus: status,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      name,
      ok: false,
      errorCode: error instanceof Error ? error.message : 'unknown',
      durationMs: Math.round(performance.now() - started),
    };
  }
}

async function expectJsonStatus(url, init, validate) {
  const response = await boundedFetch(url, init);
  if (response.status !== 200) throw new Error(`http-${response.status}`);
  const value = await body(response);
  if (!validate(value)) throw new Error('unexpected-response');
  return response.status;
}

export async function monitor(config, { frontendCookieHeader = '' } = {}) {
  const commonHeaders = {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
  };
  const checks = [];
  checks.push(await runCheck('frontend', async () => {
    const headers = {
      Accept: 'text/html',
      ...(frontendCookieHeader ? { Cookie: frontendCookieHeader } : {}),
    };
    const response = await boundedFetch(config.appUrl, { headers });
    if (response.status !== 200) throw new Error(`http-${response.status}`);
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) {
      throw new Error('unexpected-content-type');
    }
    await response.arrayBuffer();
    return response.status;
  }));
  checks.push(await runCheck('supabase-auth', () => expectJsonStatus(
    `${config.supabaseUrl}/auth/v1/health`,
    { headers: commonHeaders },
    (value) => value !== null && typeof value === 'object',
  )));
  checks.push(await runCheck('supabase-rest-rls', async () => {
    const response = await boundedFetch(
      `${config.supabaseUrl}/rest/v1/profiles?select=id&limit=0`,
      { headers: { ...commonHeaders, Accept: 'application/json' } },
    );
    if (response.status !== 200) throw new Error(`http-${response.status}`);
    const value = await body(response);
    if (!Array.isArray(value) || value.length !== 0) throw new Error('unexpected-response');
    return response.status;
  }));
  checks.push(await runCheck('supabase-storage', async () => {
    const response = await boundedFetch(
      `${config.supabaseUrl}/storage/v1/status`,
      { headers: commonHeaders },
    );
    if (response.status !== 200) throw new Error(`http-${response.status}`);
    await response.arrayBuffer();
    return response.status;
  }));
  checks.push(await runCheck('clamav-health', () => expectJsonStatus(
    healthUrlForScan(config.scanUrl),
    { headers: { Accept: 'application/json' } },
    (value) => value?.status === 'ok',
  )));
  const scannerHeaders = {
    Authorization: `Bearer ${config.scanToken}`,
    'Content-Type': 'application/octet-stream',
  };
  checks.push(await runCheck('clamav-clean-fixture', () => expectJsonStatus(
    config.scanUrl,
    { method: 'POST', headers: scannerHeaders, body: 'MedData synthetic monitoring fixture' },
    (value) => value?.status === 'clean' && value?.engine === 'clamav',
  )));
  const eicar = ['X5O!P%@AP[4', '\\PZX54(P^)7CC)7}$EICAR-', 'STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');
  checks.push(await runCheck('clamav-eicar-fixture', () => expectJsonStatus(
    config.scanUrl,
    { method: 'POST', headers: scannerHeaders, body: eicar },
    (value) => value?.status === 'infected'
      && value?.engine === 'clamav'
      && /eicar/i.test(value?.signature ?? ''),
  )));
  return checks;
}

async function main() {
  const config = validateMonitorConfiguration();
  let frontendCookieHeader = '';
  if (config.frontendStorageStatePath) {
    const serializedState = await readFile(config.frontendStorageStatePath, 'utf8');
    if (Buffer.byteLength(serializedState, 'utf8') > 64 * 1024) {
      throw new Error('Etat Vercel de monitoring trop volumineux.');
    }
    let storageState;
    try {
      storageState = JSON.parse(serializedState);
    } catch {
      throw new Error('Etat Vercel de monitoring invalide.');
    }
    frontendCookieHeader = vercelCookieHeaderFromStorageState(storageState, config.appUrl);
  }
  const checks = await monitor(config, { frontendCookieHeader });
  const evidence = {
    format: 'meddata-operations-monitor/v1',
    observedAt: new Date().toISOString(),
    target: config.target,
    projectRef: config.projectRef,
    appOriginSha256: sha256(new URL(config.appUrl).origin),
    ok: checks.every((check) => check.ok),
    checks,
  };
  const output = resolve(process.env.MONITOR_OUTPUT || 'monitor-evidence.json');
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name} (${check.durationMs} ms${check.httpStatus ? `, HTTP ${check.httpStatus}` : ''})`);
  }
  if (!evidence.ok) process.exitCode = 1;
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((error) => {
    console.error(`Monitoring impossible: ${error instanceof Error ? error.message : 'erreur inconnue'}`);
    process.exitCode = 1;
  });
}
