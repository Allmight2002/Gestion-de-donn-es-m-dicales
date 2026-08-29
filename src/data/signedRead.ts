// URL signee pour lire un fichier prive (image clinique, document du pool ou export conserve).
//
// PRODUCTION (VITE_USE_SIGNED_READ=true) : passe par la fonction Edge `signed-read` qui
// AUTORISE (RLS), JOURNALISE (audit_log) puis SIGNE cote serveur -> la consultation ne peut
// PAS se faire sans trace (audit §9.2/§10.1). Le frontend ne signe plus lui-meme.
//
// LOCAL / DEMO (flag absent) : repli sur la signature client directe (aucune Edge Function
// deployee en local) -> le flux de demonstration continue de fonctionner.
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '../lib/edgeFunctionError';

const USE_SIGNED_READ = import.meta.env.VITE_USE_SIGNED_READ === 'true';

export async function signedRead(
  client: SupabaseClient,
  entity: 'attachment' | 'raw_document' | 'export',
  id: string,
  bucket: string,
  storagePath: string,
  ttl: number,
): Promise<string | null> {
  if (USE_SIGNED_READ) {
    // Le refus de l'Edge Function (quarantaine, inspection en cours, droits) est REMONTE : il etait
    // auparavant avale en `null`, ce qui rendait un refus legitime indiscernable d'un fichier absent.
    const data = await invokeEdgeFunction<{ url?: string }>(client, 'signed-read', { entity, id });
    return data?.url ?? null;
  }
  // §5.7 — Ceinture + bretelles : en production, le repli de signature client (non audite) est
  // INTERDIT. Le build l'impose deja (vite.config) ; si un bundle mal configure arrivait quand meme
  // en prod, on refuse la lecture plutot que de livrer un fichier sans trace d'audit.
  if (import.meta.env.PROD) {
    throw new Error('Lecture de fichier indisponible : configuration signed-read manquante (audit requis).');
  }
  const { data } = await client.storage.from(bucket).createSignedUrl(storagePath, ttl);
  return data?.signedUrl ?? null;
}
