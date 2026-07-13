import type { SupabaseClient } from '@supabase/supabase-js';
import { readJsonObject, RequestValidationError, UUID_RE, validationResponse } from '../_shared/contracts.ts';

export interface FinalizeUploadDeps {
  buildClients: (authHeader: string) => { asUser: SupabaseClient; admin: SupabaseClient };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const hex = (bytes: Uint8Array): string => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)));
const mime = (value: string | null | undefined): string => (value ?? '').split(';', 1)[0].trim().toLowerCase();

type UploadEntity = 'attachment' | 'raw_document';
interface FinalizeRequest {
  ticketId: string;
  entity: UploadEntity;
  metadata: Record<string, unknown>;
}

function parse(body: Record<string, unknown>): FinalizeRequest {
  if (typeof body.ticketId !== 'string' || !UUID_RE.test(body.ticketId)) {
    throw new RequestValidationError(400, 'ticketId invalide');
  }
  if (body.entity !== 'attachment' && body.entity !== 'raw_document') {
    throw new RequestValidationError(400, 'Entite upload invalide');
  }
  if (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
    throw new RequestValidationError(400, 'Metadonnees upload invalides');
  }
  return { ticketId: body.ticketId, entity: body.entity, metadata: body.metadata as Record<string, unknown> };
}

export async function handleFinalizeUpload(req: Request, deps: FinalizeUploadDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });
  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise' });

  let input: FinalizeRequest;
  try {
    input = parse(await readJsonObject(req));
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

  const { data: ticket, error: ticketError } = await asUser.from('upload_ticket')
    .select('id, owner_user_id, base_id, bucket, path, status, expires_at, file_hash, file_size, mime_type')
    .eq('id', input.ticketId).maybeSingle();
  if (ticketError || !ticket) return json(404, { error: 'Operation upload introuvable' });
  const expectedBucket = input.entity === 'attachment' ? 'clinical-attachments' : 'raw-documents';
  if (ticket.bucket !== expectedBucket || !String(ticket.path).startsWith(`${ticket.base_id}/`)) {
    return json(409, { error: 'Operation upload incoherente' });
  }
  if (ticket.status !== 'pending' && ticket.status !== 'attached') {
    return json(409, { error: 'Operation upload indisponible' });
  }
  if (ticket.status === 'pending' && Date.parse(ticket.expires_at) <= Date.now()) {
    return json(409, { error: 'Operation upload expiree' });
  }

  const verifyObject = async () => {
    const { data: blob, error } = await admin.storage.from(ticket.bucket).download(ticket.path);
    if (error || !blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { hash: await sha256Hex(bytes), size: bytes.byteLength, mimeType: mime(blob.type) };
  };
  const proof = await verifyObject();
  if (!proof) return json(409, { error: 'Objet Storage absent' });
  if (
    proof.hash !== ticket.file_hash || proof.size !== Number(ticket.file_size) ||
    !proof.mimeType || proof.mimeType !== mime(ticket.mime_type)
  ) return json(409, { error: 'Objet Storage incoherent' });

  const { data: documentId, error: completeError } = await admin.rpc('complete_verified_upload_operation', {
    p_ticket_id: input.ticketId,
    p_user_id: who.user.id,
    p_entity: input.entity,
    p_metadata: input.metadata,
    p_verified_file_hash: proof.hash,
    p_verified_file_size: proof.size,
    p_verified_mime_type: proof.mimeType,
  });
  if (completeError || typeof documentId !== 'string') {
    console.error('finalize-upload completion failed');
    return json(409, { error: 'Finalisation upload refusee' });
  }

  // Compensate the SQL row if the object disappeared or changed between the
  // first proof and the business-row transaction.
  const postProof = await verifyObject();
  if (
    !postProof || postProof.hash !== proof.hash || postProof.size !== proof.size ||
    postProof.mimeType !== proof.mimeType
  ) {
    const { data: rolledBack, error: rollbackError } = await admin.rpc('rollback_verified_upload_operation', {
      p_ticket_id: input.ticketId,
      p_user_id: who.user.id,
      p_document_id: documentId,
    });
    if (rollbackError || rolledBack !== true) {
      console.error('finalize-upload compensation failed');
      return json(500, { error: 'Finalisation incertaine : reconciliation serveur requise' });
    }
    return json(409, { error: 'Objet Storage disparu pendant la finalisation' });
  }
  return json(200, { id: documentId });
}
