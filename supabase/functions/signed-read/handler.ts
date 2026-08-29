// Handler testable de signed-read (audit lot 9 §C3). La logique d'autorisation/journalisation/signature
// vit ici et recoit ses dependances externes (clients Supabase, drapeau d'inspection) par injection ;
// index.ts n'est qu'un adaptateur Deno.serve. Aucune duplication : c'est l'unique implementation.
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseEntityId, readJsonObject, validationResponse } from '../_shared/contracts.ts';

export interface SignedReadDeps {
  // Construit les deux clients (contexte utilisateur RLS + service_role) ; LEVE si la config manque.
  buildClients: (authHeader: string) => { asUser: SupabaseClient; admin: SupabaseClient };
  // Exige le verdict serveur strict `accepted` (environnements cliniques).
  requireInspection: () => boolean;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

function inspectionGate(status: string | null | undefined, requireInspection: boolean): Response | null {
  if (status === 'quarantined') {
    return json(409, { error: 'Fichier en quarantaine : lecture refusee' });
  }
  if (status === 'pending' || status === 'scanning') {
    return json(409, { error: "Document non encore valide par l'inspection serveur" });
  }
  if (requireInspection && status !== 'accepted') {
    return json(409, { error: "Document non valide par l'inspection serveur" });
  }
  return null;
}

export async function handleSignedRead(req: Request, deps: SignedReadDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise' });

  let entity: 'attachment' | 'raw_document' | 'export';
  let id: string;
  try {
    ({ entity, id } = parseEntityId(await readJsonObject(req), ['attachment', 'raw_document', 'export']) as {
      entity: typeof entity;
      id: string;
    });
  } catch (error) {
    return validationResponse(error);
  }

  let asUser: SupabaseClient;
  let admin: SupabaseClient;
  try {
    ({ asUser, admin } = deps.buildClients(auth));
  } catch {
    return json(500, { error: 'Configuration serveur indisponible' });
  }

  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });

  // Les statuts non lisibles (pending/scanning/quarantined) sont TOUJOURS refuses. Le flag ne
  // sert qu'a exiger le verdict serveur strict `accepted` dans les environnements cliniques.
  const requireInspection = deps.requireInspection();

  let bucket: string, action: string, path: string, baseId: string | null;
  let downloadFilename: string | undefined;

  if (entity === 'raw_document') {
    const { data, error } = await asUser
      .from('raw_document').select('id, base_id, storage_path, inspection_status').eq('id', id).is('deleted_at', null)
      .maybeSingle();
    if (error || !data) return json(403, { error: 'Acces refuse' }); // RLS a masque -> non autorise
    const gate = inspectionGate(data.inspection_status, requireInspection);
    if (gate) return gate;
    bucket = 'raw-documents';
    action = 'raw_document_read';
    path = data.storage_path;
    baseId = data.base_id;
  } else if (entity === 'attachment') {
    const { data, error } = await asUser
      .from('clinical_attachment').select('id, patient_id, storage_path, inspection_status').eq('id', id).is(
        'deleted_at',
        null,
      ).maybeSingle();
    if (error || !data) return json(403, { error: 'Acces refuse' });
    const gate = inspectionGate(data.inspection_status, requireInspection);
    if (gate) return gate;
    const { data: pat } = await admin.from('patient').select('base_id').eq('id', data.patient_id).maybeSingle();
    bucket = 'clinical-attachments';
    action = 'attachment_read';
    path = data.storage_path;
    baseId = pat?.base_id ?? null;
  } else {
    const { data, error } = await asUser
      .from('export_log').select('id, base_id, stored_file_path, export_options').eq('id', id).maybeSingle();
    if (error || !data || !data.stored_file_path) return json(403, { error: 'Acces refuse' });
    bucket = 'scientific-exports';
    action = 'export_read';
    path = data.stored_file_path;
    const requestedFilename = (data.export_options as { download_filename?: unknown } | null)?.download_filename;
    if (
      typeof requestedFilename === 'string' && requestedFilename.length <= 180 &&
      /^meddata_[a-z0-9_Z-]+\.(csv|xlsx)$/.test(requestedFilename)
    ) {
      downloadFilename = requestedFilename;
    }
    baseId = data.base_id ?? null;
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

  const { error: auditErr } = await admin.from('audit_log').insert({
    user_id: who.user.id,
    action,
    entity,
    entity_id: id,
    base_id: baseId,
  });
  if (auditErr) return json(500, { error: 'Journalisation impossible : acces refuse' });

  const signedOptions = entity === 'export' ? { download: downloadFilename ?? true } : undefined;
  const { data: signed, error: e2 } = await admin.storage.from(bucket).createSignedUrl(path, 120, signedOptions);
  if (e2 || !signed) return json(500, { error: 'Signature impossible' });
  return json(200, { url: signed.signedUrl });
}
