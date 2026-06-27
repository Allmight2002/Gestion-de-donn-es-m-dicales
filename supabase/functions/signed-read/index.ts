// @ts-nocheck — Fonction Edge Supabase (runtime Deno) : NON compilee par le build Vite ni les
// tests (PostgreSQL embarque). A DEPLOYER sur le projet cloud : `supabase functions deploy signed-read`.
//
// Audit §10.1 : generation d'URL signee AUDITEE et non contournable. Aujourd'hui le frontend
// signe lui-meme l'URL (storage.createSignedUrl) puis journalise « best effort » -> un client
// peut ouvrir un document SANS tracer. Ici, l'URL n'est obtenable QUE par cette fonction :
//   1) AUTORISATION reutilisant la RLS : on lit la ligne avec le JWT de l'utilisateur. Si la
//      RLS la masque, l'acces est refuse (memes regles que l'app, zero duplication).
//   2) JOURNALISATION (audit_log) AVANT de livrer l'URL -> la trace est garantie.
//   3) SIGNATURE via la cle service_role (que seul ce serveur detient ; buckets prives).
//
// Appel cote client : supabase.functions.invoke('signed-read', { body: { entity, id } })
//   entity = 'attachment' (image clinique) | 'raw_document' (document du pool)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise' });

  let payload: { entity?: string; id?: string };
  try { payload = await req.json(); } catch { return json(400, { error: 'Corps JSON requis' }); }
  const { entity, id } = payload;
  if ((entity !== 'attachment' && entity !== 'raw_document') || !id) {
    return json(400, { error: 'entity (attachment|raw_document) et id sont requis' });
  }

  const URL = Deno.env.get('SUPABASE_URL')!;
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Client CONTEXTE UTILISATEUR (RLS appliquee) — sert UNIQUEMENT a autoriser.
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  // Client SERVICE_ROLE — journalise + signe (jamais expose au navigateur).
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });

  let bucket: string, action: string, path: string, baseId: string | null;

  if (entity === 'raw_document') {
    const { data, error } = await asUser
      .from('raw_document').select('id, base_id, storage_path').eq('id', id).is('deleted_at', null).maybeSingle();
    if (error || !data) return json(403, { error: 'Acces refuse' }); // RLS a masque -> non autorise
    bucket = 'raw-documents'; action = 'raw_document_read'; path = data.storage_path; baseId = data.base_id;
  } else {
    const { data, error } = await asUser
      .from('clinical_attachment').select('id, patient_id, storage_path').eq('id', id).is('deleted_at', null).maybeSingle();
    if (error || !data) return json(403, { error: 'Acces refuse' });
    const { data: pat } = await admin.from('patient').select('base_id').eq('id', data.patient_id).maybeSingle();
    bucket = 'clinical-attachments'; action = 'attachment_read'; path = data.storage_path; baseId = pat?.base_id ?? null;
  }

  // Trace AVANT livraison (non contournable).
  await admin.from('audit_log').insert({ user_id: who.user.id, action, entity, entity_id: id, base_id: baseId });

  const { data: signed, error: e2 } = await admin.storage.from(bucket).createSignedUrl(path, 120);
  if (e2 || !signed) return json(500, { error: e2?.message ?? 'Signature impossible' });
  return json(200, { url: signed.signedUrl });
});
