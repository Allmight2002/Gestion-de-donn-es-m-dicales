import { chmod, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const VERCEL_COOKIE_NAME = '_vercel_jwt';
const HTTP_ONLY_PREFIX = '#HttpOnly_';

export function validatedVercelDeploymentHostname(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Le deploiement Vercel doit etre une URL valide.');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.vercel.app') ||
    url.username ||
    url.password
  ) {
    throw new Error('Le deploiement Vercel doit etre une URL HTTPS *.vercel.app sans identifiants.');
  }
  return url.hostname.toLowerCase();
}

export function createVercelStorageState(cookieJar, rawDeploymentUrl, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expectedHostname = validatedVercelDeploymentHostname(rawDeploymentUrl);
  const cookies = [];

  for (const originalLine of cookieJar.split(/\r?\n/u)) {
    if (!originalLine.trim()) continue;
    const httpOnly = originalLine.startsWith(HTTP_ONLY_PREFIX);
    if (originalLine.startsWith('#') && !httpOnly) continue;

    const line = httpOnly ? originalLine.slice(HTTP_ONLY_PREFIX.length) : originalLine;
    const fields = line.split('\t');
    if (fields.length !== 7) continue;
    const [rawDomain, , path, rawSecure, rawExpires, name, value] = fields;
    if (name !== VERCEL_COOKIE_NAME) continue;

    const domain = rawDomain.replace(/^\./u, '').toLowerCase();
    const expires = Number(rawExpires);
    if (domain !== expectedHostname) {
      throw new Error('Le cookie Vercel ne correspond pas au deploiement staging exact.');
    }
    if (!httpOnly || rawSecure !== 'TRUE' || path !== '/') {
      throw new Error('Le cookie Vercel doit etre HttpOnly, Secure et limite au chemin racine.');
    }
    if (!Number.isInteger(expires) || expires <= nowSeconds) {
      throw new Error('Le cookie Vercel est expire ou possede une expiration invalide.');
    }
    if (!value) throw new Error('Le cookie Vercel est vide.');

    cookies.push({
      name,
      value,
      domain,
      path,
      expires,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });
  }

  if (cookies.length !== 1) {
    throw new Error('Un unique cookie Vercel valide est requis pour les E2E staging.');
  }
  return { cookies, origins: [] };
}

export async function writeVercelStorageState(cookieJarPath, outputPath, rawDeploymentUrl) {
  const cookieJar = await readFile(cookieJarPath, 'utf8');
  const storageState = createVercelStorageState(cookieJar, rawDeploymentUrl);
  await writeFile(outputPath, `${JSON.stringify(storageState)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(outputPath, 0o600).catch(() => undefined);
  return {
    hostname: storageState.cookies[0].domain,
    cookieCount: storageState.cookies.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cookieJarPath, outputPath, deploymentUrl] = process.argv.slice(2);
  if (!cookieJarPath || !outputPath || !deploymentUrl) {
    console.error('Usage: node scripts/vercel-cookie-state.mjs <cookie-jar> <storage-state> <deployment-url>');
    process.exitCode = 1;
  } else {
    try {
      const result = await writeVercelStorageState(cookieJarPath, outputPath, deploymentUrl);
      console.log(
        `Etat navigateur Vercel prepare pour ${result.hostname} (${result.cookieCount} cookie; valeur masquee).`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Preparation du cookie Vercel impossible.');
      process.exitCode = 1;
    }
  }
}
