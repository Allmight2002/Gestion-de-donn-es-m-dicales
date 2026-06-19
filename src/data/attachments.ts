// Couche d'acces aux pieces jointes cliniques (cahier v3.0 §4.2, §13, §14).
// Zone restreinte : la RLS de `clinical_attachment` cloisonne l'acces (can_view_identity) ;
// le Storage (bucket prive + URL signees temporaires) detient les octets. Les IMAGES sont
// reencodees a l'upload (suppression EXIF) ; les PDF/Office sont envoyes tels quels. Le
// libelle du document est OBLIGATOIRE. Un fichier a la fois.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { validateAttachmentFile } from '../domain/imageUpload';

export const ATTACHMENTS_BUCKET = 'clinical-attachments';
const SIGNED_URL_TTL = 60 * 10; // 10 min

export interface AttachmentItem {
  id: string;
  kind: string | null;
  label: string | null;
  mimeType: string | null;
  filePath: string;
  signedUrl: string | null;
}

export interface AddImageInput {
  patientId: string;
  baseId: string;
  encounterId?: string | null;
  file: File;
  label: string; // libelle OBLIGATOIRE (cahier §14)
  deidentificationConfirmed: boolean;
}

export interface AttachmentRepository {
  listAttachments(patientId: string): Promise<AttachmentItem[]>;
  addImage(input: AddImageInput): Promise<{ id: string }>;
  softDeleteAttachment(id: string, reason: string): Promise<void>;
}

type AttachmentRow = { id: string; kind: string | null; label: string | null; mime_type: string | null; storage_path: string };

const NOT_CONFIGURED = 'Backend Supabase non configure';

// Reencodage via canvas : supprime les metadonnees (EXIF/GPS). Navigateur uniquement.
async function reencodeImage(file: File, type: string): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');
  ctx.drawImage(bitmap, 0, 0);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Echec du reencodage'))), type, 0.92),
  );
}

export function makeAttachmentRepository(client: SupabaseClient | null): AttachmentRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { listAttachments: fail, addImage: fail, softDeleteAttachment: fail };
  }

  return {
    async listAttachments(patientId) {
      const { data, error } = await client
        .from('clinical_attachment')
        .select('id, kind, label, mime_type, storage_path')
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as AttachmentRow[];
      const items = await Promise.all(
        rows.map(async (r) => {
          const { data: signed } = await client.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(r.storage_path, SIGNED_URL_TTL);
          return { id: r.id, kind: r.kind, label: r.label, mimeType: r.mime_type, filePath: r.storage_path, signedUrl: signed?.signedUrl ?? null };
        }),
      );
      return items;
    },

    async addImage(input) {
      // Defense : deidentification confirmee + libelle + format valide (re-verifies cote
      // DB par la contrainte CHECK et la RLS).
      if (!input.deidentificationConfirmed) throw new Error('La deidentification doit etre confirmee avant tout envoi');
      if (!input.label?.trim()) throw new Error('Le libelle du document est requis');
      const v = validateAttachmentFile(input.file);
      if (!v.ok) throw new Error(v.error);

      // Images : reencodees (EXIF supprime). Documents (PDF/Office) : envoyes tels quels.
      const blob: Blob = v.isImage ? await reencodeImage(input.file, v.type) : input.file;
      const path = `${input.baseId}/${input.patientId}/${crypto.randomUUID()}.${v.ext}`;
      const { error: upErr } = await client.storage.from(ATTACHMENTS_BUCKET).upload(path, blob, {
        contentType: v.type,
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data, error } = await client
        .from('clinical_attachment')
        .insert({
          patient_id: input.patientId,
          encounter_id: input.encounterId ?? null,
          kind: v.isImage ? 'imagerie' : 'document',
          label: input.label.trim(),
          storage_path: path,
          mime_type: v.type,
          deidentification_confirmed: true,
        })
        .select('id')
        .single();
      if (error) {
        // Nettoyage best-effort de l'octet uploade si la ligne n'a pas pu etre creee.
        await client.storage.from(ATTACHMENTS_BUCKET).remove([path]);
        throw error;
      }
      return { id: (data as { id: string }).id };
    },

    async softDeleteAttachment(id, reason) {
      const { error } = await client.rpc('soft_delete_attachment', { p_attachment_id: id, p_reason: reason });
      if (error) throw error;
    },
  };
}

export const attachmentRepository: AttachmentRepository = makeAttachmentRepository(supabase);
