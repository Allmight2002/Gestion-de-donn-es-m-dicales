import type { SupabaseClient } from '@supabase/supabase-js';

export const REQUIRE_SERVER_INSPECTION = import.meta.env.VITE_REQUIRE_SERVER_INSPECTION === 'true';

type InspectEntity = 'attachment' | 'raw_document';
type CleanupBucket = 'clinical-attachments' | 'raw-documents' | 'scientific-exports';
type InspectUploadResponse = {
  status?: 'accepted' | 'quarantined';
  error?: string;
  signature?: string;
};

async function functionErrorMessage(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json() as { error?: unknown; signature?: unknown };
      const detail = typeof body.error === 'string' ? body.error : null;
      const signature = typeof body.signature === 'string' ? body.signature : null;
      return [detail, signature ? `signature: ${signature}` : null].filter(Boolean).join(' - ') || null;
    } catch {
      return null;
    }
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

export async function inspectUploadedFile(client: SupabaseClient, entity: InspectEntity, id: string): Promise<void> {
  if (!REQUIRE_SERVER_INSPECTION) return;

  const { data, error } = await client.functions.invoke<InspectUploadResponse>('inspect-upload', {
    body: { entity, id },
  });
  if (error) {
    const detail = await functionErrorMessage(error);
    throw new Error(`Inspection antivirus impossible${detail ? ` : ${detail}` : ''}.`);
  }

  if (data?.status !== 'accepted') {
    const detail = data?.error ?? (data?.status === 'quarantined' ? 'fichier mis en quarantaine' : 'verdict absent');
    throw new Error(`Inspection antivirus non validee : ${detail}.`);
  }
}

export async function cleanupUploadedObject(client: SupabaseClient, bucket: CleanupBucket, path: string): Promise<void> {
  const { error } = await client.functions.invoke('cleanup-upload', {
    body: { bucket, path },
  });
  if (error) {
    const detail = await functionErrorMessage(error);
    throw new Error(`Nettoyage Storage impossible${detail ? ` : ${detail}` : ''}.`);
  }
}
