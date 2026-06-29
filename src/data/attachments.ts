// Couche d'acces aux pieces jointes cliniques (cahier v3.0 §4.2, §13, §14).
// Zone restreinte : la RLS de `clinical_attachment` cloisonne l'acces (can_view_identity) ;
// le Storage (bucket prive + URL signees temporaires) detient les octets. Les IMAGES sont
// reencodees a l'upload (suppression EXIF) ; les PDF/Office sont envoyes tels quels. Le
// libelle du document est OBLIGATOIRE. Un fichier a la fois.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { inspectFile, sha256Hex } from '../domain/imageUpload';
import { signedRead } from './signedRead';

export const ATTACHMENTS_BUCKET = 'clinical-attachments';
const SIGNED_URL_TTL = 60 * 10; // 10 min

export interface AttachmentItem {
  id: string;
  kind: string | null;
  label: string | null;
  mimeType: string | null;
  filePath: string;
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
  /** §11 — URL signee generee A LA DEMANDE (au clic), pas au chargement de la liste : autorisation
   *  + audit ne se declenchent que pour une VRAIE tentative de consultation. null si indisponible. */
  attachmentUrl(id: string, storagePath: string): Promise<string | null>;
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
    return { listAttachments: fail, attachmentUrl: fail, addImage: fail, softDeleteAttachment: fail };
  }

  return {
    async listAttachments(patientId) {
      // §11 : la liste ne genere AUCUNE URL signee (donc aucun audit) ; seul l'octet est cloisonne
      // par la RLS. L'URL est demandee a l'ouverture du document (attachmentUrl).
      const { data, error } = await client
        .from('clinical_attachment')
        .select('id, kind, label, mime_type, storage_path')
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as AttachmentRow[]).map((r) => ({
        id: r.id, kind: r.kind, label: r.label, mimeType: r.mime_type, filePath: r.storage_path,
      }));
    },

    async attachmentUrl(id, storagePath) {
      return signedRead(client, 'attachment', id, ATTACHMENTS_BUCKET, storagePath, SIGNED_URL_TTL);
    },

    async addImage(input) {
      // Defense : deidentification confirmee + libelle + format valide (re-verifies cote
      // DB par la contrainte CHECK et la RLS).
      if (!input.deidentificationConfirmed) throw new Error('La deidentification doit etre confirmee avant tout envoi');
      if (!input.label?.trim()) throw new Error('Le libelle du document est requis');
      // Inspection par magic bytes (§5.3) : refuse un fichier deguise (ex. .exe en .pdf).
      const v = await inspectFile(input.file);
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
          detected_mime_type: v.type,
          file_size: blob.size,
          file_hash: await sha256Hex(blob),
          inspection_status: 'accepted_client',
          inspected_at: new Date().toISOString(),
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
