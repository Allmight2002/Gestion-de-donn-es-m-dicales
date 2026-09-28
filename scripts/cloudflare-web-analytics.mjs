// Mesure d'audience Cloudflare Web Analytics (beacon officiel : ni cookie, ni stockage local).
//
// La balise n'entre dans index.html qu'AU BUILD, et seulement si un jeton de site est fourni.
// La release coordonnee ne le fournit qu'au build de PRODUCTION : le developpement, la CI, le
// staging et une installation on-premise n'embarquent aucun script tiers et n'envoient rien a
// Cloudflare. La CSP de vercel.json n'autorise que ce script et son point de collecte.
//
// Le beacon retire query string et fragment des URL qu'il transmet (jeton d'invitation, retour
// de recuperation Supabase), mais il transmet le CHEMIN des pages : un chemin ne doit jamais
// porter de nom ni de valeur clinique (spec-experience-utilisateur).
export const CLOUDFLARE_BEACON_URL = 'https://static.cloudflareinsights.com/beacon.min.js';

// Jeton tel que l'affiche le tableau de bord Cloudflare. Il finit dans un attribut de la page
// servie a chaque utilisateur : une autre valeur (le snippet complet colle par megarde, par
// exemple) fait echouer le build au lieu d'etre ecrite dans le HTML.
const SITE_TOKEN = /^[0-9a-f]{32}$/;

export function cloudflareWebAnalyticsTags(env) {
  const token = env.VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN?.trim() ?? '';
  if (!token) return [];
  if (!SITE_TOKEN.test(token)) {
    throw new Error(
      'Configuration refusee : VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN doit contenir le seul jeton de site ' +
        'Cloudflare (32 caracteres hexadecimaux), pas le script complet.',
    );
  }
  return [
    {
      tag: 'script',
      attrs: { type: 'module', src: CLOUDFLARE_BEACON_URL, 'data-cf-beacon': JSON.stringify({ token }) },
      injectTo: 'body',
    },
  ];
}

// `apply: 'build'` : le serveur de developpement ne sert jamais le beacon, meme si le jeton
// traine dans un fichier .env local.
export function cloudflareWebAnalytics(env) {
  return {
    name: 'meddata-cloudflare-web-analytics',
    apply: 'build',
    transformIndexHtml: () => cloudflareWebAnalyticsTags(env),
  };
}
