// URL signee pour lire un fichier prive (image clinique ou document du pool).
//
// PRODUCTION (VITE_USE_SIGNED_READ=true) : passe par la fonction Edge `signed-read` qui
// AUTORISE (RLS), JOURNALISE (audit_log) puis SIGNE cote serveur -> la consultation ne peut
// PAS se faire sans trace (audit §9.2/§10.1). Le frontend ne signe plus lui-meme.
//
// LOCAL / DEMO (flag absent) : repli sur la signature client directe (aucune Edge Function
// deployee en local) -> le flux de demonstration continue de fonctionner.
import type { SupabaseClient } from '@supabase/supabase-js';

const USE_SIGNED_READ = import.meta.env.VITE_USE_SIGNED_READ === 'true';

export async function signedRead(
  client: SupabaseClient,
  entity: 'attachment' | 'raw_document',
  id: string,
  bucket: string,
  storagePath: string,
  ttl: number,
): Promise<string | null> {
  if (USE_SIGNED_READ) {
    const { data, error } = await client.functions.invoke('signed-read', { body: { entity, id } });
    if (error) return null;
    return (data as { url?: string } | null)?.url ?? null;
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
