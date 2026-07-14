// Extrait un message LISIBLE d'une erreur quelconque.
// Les erreurs Supabase / PostgREST ne sont PAS des instances d'Error : ce sont des objets
// { message, details, hint, code }. Le test `e instanceof Error` echoue donc, et l'UI affichait
// un message generique au lieu du VRAI motif renvoye par le serveur. On lit ici aussi `.message`
// (et quelques variantes) sur les objets pour faire remonter l'erreur reelle.
// Jetons techniques -> message ACTIONNABLE. NB : la detection de conflit de la synchro
// hors-ligne (offline.ts, isConflict) lit err.message BRUT et n'est donc pas affectee.
function humanize(message: string): string {
  if (/WRITE_NOT_FOUND/i.test(message)) {
    return "La ressource n'existe plus. Rechargez la page avant de continuer.";
  }
  if (/WRITE_FORBIDDEN/i.test(message)) {
    return "L'enregistrement a ete refuse : vos droits ou votre affectation ont change.";
  }
  if (/WRITE_STALE/i.test(message)) {
    return 'Ces donnees ont ete modifiees entre-temps. Rechargez la page avant de reessayer.';
  }
  if (/WRITE_INVALID_STATE/i.test(message)) {
    return "Cette operation n'est plus possible dans l'etat actuel de la ressource. Rechargez la page.";
  }
  if (/WRITE_INVALID_INPUT/i.test(message)) {
    return "Les donnees envoyees ne respectent pas la structure attendue et n'ont pas ete enregistrees.";
  }
  if (/WRITE_FAILED/i.test(message)) {
    return "L'enregistrement n'a pas pu etre confirme. Aucun succes n'est affiche ; rechargez avant de reessayer.";
  }
  if (/CONFLIT_VERSION/i.test(message)) {
    return 'Cette rencontre a été modifiée entre-temps (autre utilisateur ou autre onglet). '
      + 'Rechargez la fiche pour voir la version à jour, puis réappliquez votre correction.';
  }
  return message;
}

export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return humanize(e.message);
  if (typeof e === 'string' && e) return humanize(e);
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    for (const k of ['message', 'error_description', 'error', 'hint', 'details']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return humanize(v);
    }
  }
  return fallback;
}
