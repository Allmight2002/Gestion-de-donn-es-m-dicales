import { describe, expect, test } from 'vitest';
import {
  CLOUDFLARE_BEACON_URL,
  cloudflareWebAnalytics,
  cloudflareWebAnalyticsTags,
} from '../scripts/cloudflare-web-analytics.mjs';

const TOKEN = 'd65fbff4ab914c7ba39a311f00072bb7';

describe('mesure d audience Cloudflare Web Analytics', () => {
  test('sans jeton, aucune balise : dev, CI, staging et on-premise restent sans script tiers', () => {
    expect(cloudflareWebAnalyticsTags({})).toEqual([]);
    expect(cloudflareWebAnalyticsTags({ VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN: '' })).toEqual([]);
    expect(cloudflareWebAnalyticsTags({ VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN: '  ' })).toEqual([]);
  });

  test('avec le jeton du site, ajoute le beacon officiel en fin de body', () => {
    expect(cloudflareWebAnalyticsTags({ VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN: ` ${TOKEN}\n` })).toEqual([
      {
        tag: 'script',
        attrs: { type: 'module', src: CLOUDFLARE_BEACON_URL, 'data-cf-beacon': `{"token":"${TOKEN}"}` },
        injectTo: 'body',
      },
    ]);
  });

  test('refuse une valeur qui n est pas un jeton de site plutot que de l ecrire dans la page', () => {
    const snippet = `<script type='module' src='${CLOUDFLARE_BEACON_URL}' data-cf-beacon='{"token": "${TOKEN}"}'></script>`;
    for (const value of [snippet, `${TOKEN}"><script>`, TOKEN.slice(1), TOKEN.toUpperCase()]) {
      expect(() => cloudflareWebAnalyticsTags({ VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN: value }))
        .toThrow(/32 caracteres hexadecimaux/);
    }
  });

  test('le plugin n agit qu au build, jamais sur le serveur de developpement', () => {
    const env = { VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN: TOKEN };
    const plugin = cloudflareWebAnalytics(env);
    expect(plugin.apply).toBe('build');
    expect((plugin.transformIndexHtml as () => unknown)()).toEqual(cloudflareWebAnalyticsTags(env));
  });
});
