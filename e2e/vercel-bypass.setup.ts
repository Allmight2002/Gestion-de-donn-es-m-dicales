import { request, type FullConfig } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { VERCEL_BYPASS_STORAGE_STATE } from './vercel-bypass-state';

export default async function vercelBypassSetup(_config: FullConfig) {
  if (process.env.E2E_TARGET !== 'staging' || !process.env.E2E_BASE_URL) return;

  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!secret) throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET est requis pour le staging protege.');

  const baseUrl = new URL(process.env.E2E_BASE_URL);
  if (baseUrl.protocol !== 'https:' || !baseUrl.hostname.endsWith('.vercel.app')) {
    throw new Error('Le bypass Vercel ne peut etre envoye qu a une URL HTTPS *.vercel.app.');
  }

  await rm(VERCEL_BYPASS_STORAGE_STATE, { force: true });
  const api = await request.newContext({
    baseURL: baseUrl.origin,
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': secret,
      'x-vercel-set-bypass-cookie': 'true',
    },
  });

  try {
    // Cette requete n'execute aucun JavaScript : le secret ne peut pas etre propage aux appels Supabase.
    const response = await api.get('/', { maxRedirects: 0 });
    const finalUrl = new URL(response.url());
    if (!response.ok() || finalUrl.hostname !== baseUrl.hostname) {
      throw new Error('Le bypass Vercel n a pas donne acces au deploiement staging attendu.');
    }
    const state = await api.storageState();
    const hasHostCookie = state.cookies.some((cookie) => {
      const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
      return baseUrl.hostname === domain || baseUrl.hostname.endsWith(`.${domain}`);
    });
    if (!hasHostCookie) {
      throw new Error('Vercel n a pas emis le cookie de bypass staging attendu.');
    }
    await api.storageState({ path: VERCEL_BYPASS_STORAGE_STATE });
  } finally {
    await api.dispose();
  }

  return async () => {
    await rm(VERCEL_BYPASS_STORAGE_STATE, { force: true });
  };
}
