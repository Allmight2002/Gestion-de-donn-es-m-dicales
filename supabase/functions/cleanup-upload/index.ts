// @ts-nocheck - Fonction Edge Supabase (runtime Deno), hors build Vite.
//
// Nettoyage serveur des objets Storage orphelins : les buckets prives n'exposent plus de policy
// DELETE au navigateur. Si l'upload Storage reussit mais que l'insertion metier echoue, le client
// appelle cette fonction pour supprimer l'objet, avec service_role, apres verification RLS.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const BUCKETS = {
  'clinical-attachments': {
    authRpc: 'can_write_identity',
    table: 'clinical_attachment',
    column: 'storage_path',
  },
  'raw-documents': {
    authRpc: 'is_base_owner',
    table: 'raw_document',
    column: 'storage_path',
  },
  'scientific-exports': {
    authRpc: 'can_export_data',
    table: 'export_log',
    column: 'stored_file_path',
  },
} as const;

type CleanupBucket = keyof typeof BUCKETS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBaseId(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  if (path.length < 38 || path.length > 600) return null;
  if (path.startsWith('/') || path.includes('//') || path.includes('..')) return null;
  const baseId = path.split('/')[0];
  return UUID_RE.test(baseId) ? baseId : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise' });

  let payload: { bucket?: string; path?: string; ticketId?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'Corps JSON requis' });
  }

  const bucket = payload.bucket as CleanupBucket;
  const bucketConfig = BUCKETS[bucket];
  const baseId = parseBaseId(payload.path);
  if (!bucketConfig || !baseId || !payload.path?.startsWith(`${baseId}/`)) {
    return json(400, { error: 'bucket/path invalides' });
  }
  if (typeof payload.ticketId !== 'string' || !UUID_RE.test(payload.ticketId)) {
    return json(400, { error: 'ticketId requis' });
  }

  const URL = Deno.env.get('SUPABASE_URL')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });

  const { data: ticket, error: ticketErr } = await admin
    .from('upload_ticket')
    .select('id, owner_user_id, base_id, bucket, path, status, expires_at')
    .eq('id', payload.ticketId)
    .maybeSingle();
  if (ticketErr) return json(500, { error: 'Verification du ticket impossible' });
  if (!ticket) return json(404, { error: 'Ticket upload introuvable' });
  if (
    ticket.owner_user_id !== who.user.id ||
    ticket.base_id !== baseId ||
    ticket.bucket !== bucket ||
    ticket.path !== payload.path
  ) {
    return json(403, { error: 'Ticket upload non proprietaire' });
  }
  if (ticket.status !== 'pending') return json(409, { error: 'Ticket upload deja consomme' });
  if (Date.parse(ticket.expires_at) <= Date.now()) {
    await admin.from('upload_ticket').update({ status: 'expired', last_error: 'expired before cleanup' }).eq('id', ticket.id);
    return json(410, { error: 'Ticket upload expire' });
  }

  const { data: allowed, error: allowedErr } = await asUser.rpc(bucketConfig.authRpc, { p_base: baseId });
  if (allowedErr || allowed !== true) return json(403, { error: 'Acces refuse' });

  const { data: existing, error: existingErr } = await admin
    .from(bucketConfig.table)
    .select('id')
    .eq(bucketConfig.column, payload.path)
    .limit(1)
    .maybeSingle();
  if (existingErr) return json(500, { error: 'Verification metier impossible' });
  if (existing) return json(409, { error: 'Objet deja rattache a une ligne metier' });

  const { data: claimed, error: claimErr } = await admin
    .from('upload_ticket')
    .update({ status: 'cleaning', last_error: null })
    .eq('id', ticket.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (claimErr) return json(500, { error: 'Reservation du ticket impossible' });
  if (!claimed) return json(409, { error: 'Ticket upload deja consomme' });

  const { data: removed, error: removeErr } = await admin.storage.from(bucket).remove([payload.path]);
  if (removeErr) {
    await admin
      .from('upload_ticket')
      .update({ status: 'pending', last_error: removeErr.message ?? 'storage remove failed' })
      .eq('id', ticket.id)
      .eq('status', 'cleaning');
    return json(500, { error: removeErr.message ?? 'Suppression Storage impossible' });
  }

  await admin
    .from('upload_ticket')
    .update({ status: 'cleaned', cleaned_at: new Date().toISOString(), last_error: null })
    .eq('id', ticket.id)
    .eq('status', 'cleaning');

  await admin.from('audit_log').insert({
    user_id: who.user.id,
    action: 'orphan_upload_removed',
    entity: 'storage_object',
    entity_id: null,
    base_id: baseId,
    metadata: { bucket, path: payload.path, ticket_id: ticket.id },
  });

  return json(200, { status: 'removed', count: removed?.length ?? 0 });
});
