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

type StructuredError = { code?: unknown; action?: unknown; hint?: unknown };

function structuredDetails(e: unknown): StructuredError | null {
  if (!e || typeof e !== 'object') return null;
  const object = e as Record<string, unknown>;
  for (const detailKey of ['details', 'detail'] as const) {
    if (typeof object[detailKey] !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(object[detailKey] as string);
      if (parsed && typeof parsed === 'object') return parsed as StructuredError;
    } catch {
      // Certaines bibliothèques utilisent `details` pour une phrase. Dans ce cas,
      // on conserve les attributs structurés directs éventuels.
    }
  }
  const direct = object as StructuredError;
  if ((typeof direct.code === 'string' && direct.code !== 'P0001') || typeof direct.action === 'string') return direct;
  return null;
}

/** Code fonctionnel renvoyé par une RPC, sans exposer ses détails cliniques. */
export function structuredErrorCode(e: unknown): string | null {
  const details = structuredDetails(e);
  return typeof details?.code === 'string' ? details.code : null;
}

/** Ces erreurs indiquent qu'une copie locale doit être rechargée avant toute nouvelle écriture. */
export function isRefreshRequiredError(e: unknown): boolean {
  const details = structuredDetails(e);
  const code = typeof details?.code === 'string' ? details.code : '';
  const action = typeof details?.action === 'string' ? details.action : '';
  const hint = typeof details?.hint === 'string' ? details.hint : '';
  const message = e instanceof Error ? e.message : e && typeof e === 'object'
    ? String((e as Record<string, unknown>).message ?? '') : String(e ?? '');
  return /^(block_hidden_value|contains_any_hidden_value|conflict_version)$/.test(code)
    || code === 'DRAFT_CONTEXT_CHANGED' || code === 'DRAFT_CONFLICT'
    || action === 'refresh_required' || hint === 'refresh_required'
    || /CONFLIT_VERSION/i.test(message);
}

export function errorMessage(e: unknown, fallback: string): string {
  const code = structuredErrorCode(e);
  if (code === 'block_hidden_value' || code === 'contains_any_hidden_value') {
    return 'La fiche a été modifiée ou sa visibilité a changé entre-temps. Vos saisies sont conservées : rechargez les données avant de recommencer.';
  }
  if (code === 'conflict_version') {
    return 'La fiche a été modifiée entre-temps. Vos saisies sont conservées : rechargez les données avant de recommencer.';
  }
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
