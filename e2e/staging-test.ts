import { expect, test as base, type Page } from '@playwright/test';

const BYPASS_HEADER = 'x-vercel-protection-bypass';
const SET_BYPASS_COOKIE_HEADER = 'x-vercel-set-bypass-cookie';
const STAGING_ONLY_HEADERS = new Set([BYPASS_HEADER, SET_BYPASS_COOKIE_HEADER]);

type HeaderEntry = { name: string; value: string };
type PausedRequest = {
  requestId: string;
  request: {
    url: string;
    headers: Record<string, string>;
  };
};

export function validatedStagingOrigin(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.vercel.app') ||
    url.username ||
    url.password
  ) {
    throw new Error('Le bypass Vercel ne peut etre envoye qu a une URL HTTPS *.vercel.app sans identifiants.');
  }
  return url.origin;
}

export function sanitizedHeadersForRequest(
  requestUrl: string,
  stagingOrigin: string,
  currentHeaders: Record<string, string>,
): HeaderEntry[] | undefined {
  let requestOrigin: string;
  try {
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    requestOrigin = '';
  }
  // Pour l'origine approuvee, ne pas fournir d'override CDP : le header pose par Playwright
  // reste intact. Pour TOUTE autre destination (redirection incluse), reconstruire les headers
  // sans le secret avant l'envoi reseau.
  if (requestOrigin === stagingOrigin) return undefined;

  return Object.entries(currentHeaders)
    .filter(([name]) => !STAGING_ONLY_HEADERS.has(name.toLowerCase()))
    .map(([name, value]) => ({ name, value }));
}

async function installScopedBypass(page: Page, stagingOrigin: string) {
  const session = await page.context().newCDPSession(page);
  const pending = new Set<Promise<void>>();
  let stopping = false;
  let interceptionError: Error | undefined;

  const onPaused = (event: PausedRequest) => {
    const operation = (async () => {
      try {
        const headers = sanitizedHeadersForRequest(
          event.request.url,
          stagingOrigin,
          event.request.headers,
        );
        await session.send('Fetch.continueRequest', {
          requestId: event.requestId,
          ...(headers ? { headers } : {}),
        });
      } catch (error) {
        if (!stopping && !page.isClosed()) {
          interceptionError = error instanceof Error ? error : new Error(String(error));
        }
      }
    })();
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  };

  session.on('Fetch.requestPaused', onPaused);
  // Le contexte Playwright pose le header recommande par Vercel avant de creer cette page. CDP
  // suspend ensuite CHAQUE requete et retire
  // ce header de toute origine non approuvee. Fetch.continueRequest ne propage pas ses overrides
  // aux redirections : chaque saut est donc re-evalue et nettoye avant l'envoi reseau.
  await session.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', requestStage: 'Request' }],
  });

  return async () => {
    stopping = true;
    await session.send('Fetch.disable').catch(() => undefined);
    await Promise.allSettled([...pending]);
    await session.detach().catch(() => undefined);
    if (interceptionError) throw interceptionError;
  };
}

export const test = base.extend<{ scopedVercelBypass: void }>({
  scopedVercelBypass: [
    async ({ page }, useFixture) => {
      if (process.env.E2E_TARGET !== 'staging' || !process.env.E2E_BASE_URL) {
        await useFixture();
        return;
      }

      if (!process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()) {
        throw new Error('VERCEL_AUTOMATION_BYPASS_SECRET est requis pour le staging protege.');
      }

      const stagingOrigin = validatedStagingOrigin(process.env.E2E_BASE_URL);
      const uninstall = await installScopedBypass(page, stagingOrigin);
      try {
        await useFixture();
      } finally {
        await uninstall();
      }
    },
    { auto: true },
  ],
});

export { expect };
