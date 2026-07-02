// Observabilite INTERNE (audit F-7) — filet PRIVACY-SAFE pour une app medicale : AUCUNE donnee
// n'est transmise a un service externe (pas de Sentry). On ne journalise que le niveau CODE
// (message, pile technique, arbre de composants), JAMAIS l'etat applicatif, qui pourrait contenir
// des donnees patient. Ce module est le SEUL point d'entree : un futur puits interne (p.ex. une
// table Supabase dediee, ou un ecran « etat du systeme ») se brancherait ICI, sans rien changer
// ailleurs.

export interface ClientErrorRecord {
  at: string;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  context?: string;
}

const RING_MAX = 20;
const ring: ClientErrorRecord[] = [];

export function reportClientError(error: unknown, componentStack?: string, context?: string): void {
  const e = error instanceof Error ? error : new Error(String(error));
  const rec: ClientErrorRecord = {
    at: new Date().toISOString(),
    name: e.name,
    message: e.message,
    stack: e.stack,
    componentStack: componentStack || undefined,
    context,
  };
  ring.push(rec);
  if (ring.length > RING_MAX) ring.shift();
  // Toujours visible dans la console du navigateur (inspection sur le terrain, zero fuite reseau).
  console.error('[client-error]', `${rec.name}: ${rec.message}`, rec);
}

/** Dernieres erreurs captees (in-memory, borne) — base d'un futur ecran « etat du systeme ». */
export function recentClientErrors(): ClientErrorRecord[] {
  return [...ring];
}
