import { request, type FullConfig } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { VERCEL_BYPASS_STORAGE_STATE } from './vercel-bypass-state';

export function validBypassBootstrapStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

export default async function vercelBypassSetup(_config: FullConfig) {
  if (process.env.E2E_TARGET !== 'staging' || !process.env.E2E_BASE_URL) return;

  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!secret) throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET est requis pour le staging protege.');

  const baseUrl = new URL(process.env.E2E_BASE_URL);
  if (baseUrl.protocol !== 'https:' || !baseUrl.hostname.endsWith('.vercel.app')) {
    throw new Error('Le bypass Vercel ne peut etre envoye qu a une URL HTTPS *.vercel.app.');
  }

  await rm(VERCEL_BYPASS_STORAGE_STATE, { force: true });
  const bootstrapApi = await request.newContext({
    baseURL: baseUrl.origin,
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': secret,
      'x-vercel-set-bypass-cookie': 'true',
    },
  });

  let bootstrapState;
  try {
    // Aucun JavaScript n'est execute. On bloque le suivi automatique pour que le header secret ne
    // puisse jamais etre propage par Playwright a une redirection hors origine.
    const response = await bootstrapApi.get('/', { maxRedirects: 0 });
    const responseUrl = new URL(response.url());
    if (responseUrl.hostname !== baseUrl.hostname) {
      throw new Error('Le bypass Vercel n a pas donne acces au deploiement staging attendu.');
    }
    if (!validBypassBootstrapStatus(response.status())) {
      throw new Error('Le bypass Vercel n a pas donne acces au deploiement staging attendu.');
    }

    bootstrapState = await bootstrapApi.storageState();
    const hasHostCookie = bootstrapState.cookies.some((cookie) => {
      const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
      return baseUrl.hostname === domain || baseUrl.hostname.endsWith(`.${domain}`);
    });
    if (!hasHostCookie) {
      throw new Error('Vercel n a pas emis le cookie de bypass staging attendu.');
    }
  } finally {
    await bootstrapApi.dispose();
  }

  // Second contexte SANS header secret : seul le cookie Vercel est conserve. Cela prouve a la fois
  // le bypass et l'absence de propagation du secret aux navigations ou aux appels cross-origin.
  const verificationApi = await request.newContext({ storageState: bootstrapState });
  try {
    // La cible Location du 3xx est volontairement ignoree. On recharge l'origine approuvee avec
    // le cookie host-only ; aucune redirection ne peut donc recevoir le header secret bootstrap.
    const response = await verificationApi.get(baseUrl.href);
    const finalUrl = new URL(response.url());
    if (!response.ok() || finalUrl.hostname !== baseUrl.hostname) {
      throw new Error('Le cookie de bypass Vercel ne donne pas acces au deploiement staging attendu.');
    }
    await verificationApi.storageState({ path: VERCEL_BYPASS_STORAGE_STATE });
  } finally {
    await verificationApi.dispose();
  }

  return async () => {
    await rm(VERCEL_BYPASS_STORAGE_STATE, { force: true });
  };
}
