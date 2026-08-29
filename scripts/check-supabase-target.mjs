import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAGING_PROJECT_REF = 'gmsxrniiclrheehhoakn';
export const PRODUCTION_PROJECT_REF = 'lrzmbwdnrjjzwossntun';

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/i;
const clean = (value) => value?.trim() ?? '';

export function projectRefFromSupabaseUrl(value) {
  try {
    const url = new URL(clean(value));
    const match = url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/i);
    return match?.[1].toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function projectRefFromDatabaseUrl(value) {
  try {
    const url = new URL(clean(value));
    const candidates = new Set();
    const hostMatch = url.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/i);
    if (hostMatch) candidates.add(hostMatch[1].toLowerCase());

    const username = decodeURIComponent(url.username);
    const userMatch = username.match(/(?:^|\.)([a-z0-9]{20})$/i);
    if (userMatch) candidates.add(userMatch[1].toLowerCase());

    return candidates.size === 1 ? [...candidates][0] : null;
  } catch {
    return null;
  }
}

export function validateSupabaseTarget({ target, env = process.env, frontendOnly = false }) {
  const errors = [];
  const declared = clean(env.SUPABASE_PROJECT_REF).toLowerCase();
  if (!PROJECT_REF_PATTERN.test(declared)) {
    errors.push('SUPABASE_PROJECT_REF doit etre une reference Supabase de 20 caracteres.');
  }

  const sources = [
    ['VITE_SUPABASE_URL', projectRefFromSupabaseUrl],
    ...(!frontendOnly
      ? [
          ['SUPABASE_URL', projectRefFromSupabaseUrl],
          ['SUPABASE_DB_URL', projectRefFromDatabaseUrl],
        ]
      : []),
  ];

  for (const [name, extract] of sources) {
    if (!clean(env[name])) {
      errors.push(`${name} est requis pour verifier la cible Supabase.`);
      continue;
    }
    const extracted = extract(env[name]);
    if (!extracted) {
      errors.push(`${name} ne permet pas d extraire une reference projet Supabase non ambigue.`);
    } else if (PROJECT_REF_PATTERN.test(declared) && extracted !== declared) {
      errors.push(`${name} ne correspond pas a SUPABASE_PROJECT_REF.`);
    }
  }

  if (target === 'staging' && PROJECT_REF_PATTERN.test(declared) && declared !== STAGING_PROJECT_REF) {
    errors.push('La cible staging ne correspond pas au projet staging MedData approuve.');
  }
  if (target === 'production' && PROJECT_REF_PATTERN.test(declared) && declared !== PRODUCTION_PROJECT_REF) {
    errors.push('La cible production ne correspond pas au projet production MedData approuve.');
  }

  return errors;
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const target = process.argv.find((arg) => arg.startsWith('--target='))?.slice(9) ?? '';
  const frontendOnly = process.argv.includes('--frontend-only');
  if (!['staging', 'production'].includes(target)) {
    console.error('Cible Supabase invalide: --target=staging ou --target=production est requis.');
    process.exit(1);
  }
  const errors = validateSupabaseTarget({ target, frontendOnly });
  for (const error of errors) console.error(`Cible Supabase invalide: ${error}`);
  if (errors.length) process.exit(1);
  console.log(`Cible Supabase ${target}: OK (references masquees).`);
}
