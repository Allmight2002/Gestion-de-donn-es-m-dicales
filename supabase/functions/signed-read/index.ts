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
//   entity = 'attachment' (image clinique) | 'raw_document' (document du pool) | 'export'
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise' });

  let payload: { entity?: string; id?: string };
  try { payload = await req.json(); } catch { return json(400, { error: 'Corps JSON requis' }); }
  const { entity, id } = payload;
  if ((entity !== 'attachment' && entity !== 'raw_document' && entity !== 'export') || !id) {
    return json(400, { error: 'entity (attachment|raw_document|export) et id sont requis' });
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

  // §9.4 : exiger une inspection SERVEUR aboutie (inspection_status='accepted') avant de signer.
  // Active uniquement si REQUIRE_SERVER_INSPECTION=true (donnees reelles, avec inspect-upload qui
  // promeut 'accepted_client' -> 'accepted'). Inactif pour le pilote fictif (statut 'accepted_client').
  const requireInspection = Deno.env.get('REQUIRE_SERVER_INSPECTION') === 'true';

  let bucket: string, action: string, path: string, baseId: string | null;

  if (entity === 'raw_document') {
    const { data, error } = await asUser
      .from('raw_document').select('id, base_id, storage_path, inspection_status').eq('id', id).is('deleted_at', null).maybeSingle();
    if (error || !data) return json(403, { error: 'Acces refuse' }); // RLS a masque -> non autorise
    if (requireInspection && data.inspection_status !== 'accepted') {
      return json(409, { error: 'Document non encore valide par l\'inspection serveur' });
    }
    bucket = 'raw-documents'; action = 'raw_document_read'; path = data.storage_path; baseId = data.base_id;
  } else if (entity === 'attachment') {
    const { data, error } = await asUser
      .from('clinical_attachment').select('id, patient_id, storage_path, inspection_status').eq('id', id).is('deleted_at', null).maybeSingle();
    if (error || !data) return json(403, { error: 'Acces refuse' });
    if (requireInspection && data.inspection_status !== 'accepted') {
      return json(409, { error: 'Fichier non encore valide par l\'inspection serveur' });
    }
    const { data: pat } = await admin.from('patient').select('base_id').eq('id', data.patient_id).maybeSingle();
    bucket = 'clinical-attachments'; action = 'attachment_read'; path = data.storage_path; baseId = pat?.base_id ?? null;
  } else {
    const { data, error } = await asUser
      .from('export_log').select('id, cohort_id, stored_file_path').eq('id', id).maybeSingle();
    if (error || !data || !data.stored_file_path) return json(403, { error: 'Acces refuse' });
    const { data: cohort } = await admin.from('cohort').select('base_id').eq('id', data.cohort_id).maybeSingle();
    bucket = 'scientific-exports'; action = 'export_read'; path = data.stored_file_path; baseId = cohort?.base_id ?? null;
    if (!baseId) return json(403, { error: 'Acces refuse' });
    const { data: canExport, error: canExportErr } = await asUser.rpc('can_export_data', { p_base: baseId });
    if (canExportErr || canExport !== true) return json(403, { error: 'Acces refuse' });
    if (baseId && !path.startsWith(`${baseId}/`)) {
      return json(409, { error: 'Chemin export incoherent' });
    }
  }

  // §9.3 : trace AVANT livraison ET non contournable -> si la journalisation ECHOUE, on REFUSE
  // de signer (sinon un document pourrait etre lu sans laisser de trace).
  if (!baseId) return json(403, { error: 'Acces refuse' });
  if (!path.startsWith(`${baseId}/`)) {
    return json(409, { error: 'Chemin fichier incoherent' });
  }

  const { error: auditErr } = await admin.from('audit_log').insert({ user_id: who.user.id, action, entity, entity_id: id, base_id: baseId });
  if (auditErr) return json(500, { error: 'Journalisation impossible : acces refuse' });

  const { data: signed, error: e2 } = await admin.storage.from(bucket).createSignedUrl(path, 120);
  if (e2 || !signed) return json(500, { error: e2?.message ?? 'Signature impossible' });
  return json(200, { url: signed.signedUrl });
});
