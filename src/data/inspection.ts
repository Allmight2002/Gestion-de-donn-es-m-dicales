import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction, readEdgeFunctionFailure } from '../lib/edgeFunctionError';

export const REQUIRE_SERVER_INSPECTION = import.meta.env.VITE_REQUIRE_SERVER_INSPECTION === 'true';

export type InspectionStatus = 'pending' | 'scanning' | 'accepted_client' | 'accepted' | 'quarantined';

type InspectEntity = 'attachment' | 'raw_document';
export type UploadBucket = 'clinical-attachments' | 'raw-documents' | 'scientific-exports';
export type UploadEntity = 'attachment' | 'raw_document';
type InspectUploadResponse = {
  status?: InspectionStatus;
  error?: string;
  signature?: string;
};

export function isInspectionReadable(
  status: InspectionStatus,
  requireServerInspection = REQUIRE_SERVER_INSPECTION,
): boolean {
  return status === 'accepted' || (!requireServerInspection && status === 'accepted_client');
}

export function isInspectionRetryable(
  status: InspectionStatus,
  requireServerInspection = REQUIRE_SERVER_INSPECTION,
): boolean {
  return status === 'pending' || status === 'scanning' || (requireServerInspection && status === 'accepted_client');
}

// Le refus lui-meme est lu par l'utilitaire partage ; seule la SIGNATURE virale, propre a cette
// fonction et deja affichee auparavant, est ajoutee ici.
async function inspectionFailureDetail(error: unknown): Promise<string> {
  const failure = await readEdgeFunctionFailure(error);
  const signature = typeof failure.body?.signature === 'string' ? failure.body.signature : null;
  return [failure.message, signature ? `signature: ${signature}` : null].filter(Boolean).join(' - ');
}

async function invokeInspection(client: SupabaseClient, entity: InspectEntity, id: string): Promise<void> {
  const { data, error } = await client.functions.invoke<InspectUploadResponse>('inspect-upload', {
    body: { entity, id },
  });
  if (error) {
    throw new Error(`Inspection antivirus impossible : ${await inspectionFailureDetail(error)}.`);
  }

  if (data?.status !== 'accepted') {
    const detail = data?.error ?? (data?.status === 'quarantined' ? 'fichier mis en quarantaine' : 'verdict absent');
    throw new Error(`Inspection antivirus non validee : ${detail}.`);
  }
}

export async function inspectUploadedFile(client: SupabaseClient, entity: InspectEntity, id: string): Promise<void> {
  if (!REQUIRE_SERVER_INSPECTION) return;
  await invokeInspection(client, entity, id);
}

export async function retryUploadedFileInspection(client: SupabaseClient, entity: InspectEntity, id: string): Promise<void> {
  await invokeInspection(client, entity, id);
}

export type UploadOperation = {
  ticketId: string;
  path: string;
  ticketStatus: string;
  documentId: string | null;
};

/**
 * Creates (or finds) the durable server-side identity of an upload.  The key
 * is deliberately supplied by the caller: retries must reuse it.
 */
export async function createUploadOperation(
  client: SupabaseClient,
  input: {
    baseId: string; bucket: UploadBucket; path: string; idempotencyKey: string;
    fileHash: string; fileSize: number; mimeType: string;
  },
): Promise<UploadOperation> {
  const { data, error } = await client.rpc('create_upload_operation', {
    p_base_id: input.baseId, p_bucket: input.bucket, p_path: input.path,
    p_idempotency_key: input.idempotencyKey, p_file_hash: input.fileHash,
    p_file_size: input.fileSize, p_mime_type: input.mimeType,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as {
    ticket_id: string; path: string; ticket_status: string; document_id: string | null;
  } | null;
  if (!row?.ticket_id || !row.path) throw new Error('Operation upload absente');
  return { ticketId: row.ticket_id, path: row.path, ticketStatus: row.ticket_status, documentId: row.document_id };
}

export async function finalizeUploadOperation(
  client: SupabaseClient,
  ticketId: string,
  entity: UploadEntity,
  metadata: Record<string, string | null>,
): Promise<string> {
  const data = await invokeEdgeFunction<{ id?: unknown }>(client, 'finalize-upload', {
    ticketId,
    entity,
    metadata,
  });
  const id = data?.id;
  if (typeof id !== 'string') throw new Error('Document persiste absent');
  return id;
}

const OPERATION_PREFIX = 'upload-operation:';

/**
 * Cle d'idempotence d'une operation d'upload, persistee dans le navigateur pour qu'un
 * rafraichissement ou une relance du MEME onglet/appareil retrouve la meme operation serveur.
 *
 * Portee volontairement LOCALE (localStorage) : une relance depuis un autre navigateur ou un
 * autre appareil regenere une cle et cree donc une operation distincte. Aucune garantie
 * cross-device n'est offerte a ce niveau. La securite ne repose pas dessus : le serveur
 * (`create_upload_operation`) refuse une meme cle reutilisee avec un fichier/contexte
 * different et rend deterministes les creations reellement concurrentes.
 */
export function stableUploadOperationKey(scope: string, fileHash: string, label: string | null): string {
  const key = `${OPERATION_PREFIX}${scope}:${fileHash}:${label ?? ''}`;
  try {
    const existing = globalThis.localStorage?.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    globalThis.localStorage?.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}
