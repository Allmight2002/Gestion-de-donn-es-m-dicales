// Extrait un message LISIBLE d'une erreur quelconque.
// Les erreurs Supabase / PostgREST ne sont PAS des instances d'Error : ce sont des objets
// { message, details, hint, code }. Le test `e instanceof Error` echoue donc, et l'UI affichait
// un message generique au lieu du VRAI motif renvoye par le serveur. On lit ici aussi `.message`
// (et quelques variantes) sur les objets pour faire remonter l'erreur reelle.
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    for (const k of ['message', 'error_description', 'error', 'hint', 'details']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  return fallback;
}
