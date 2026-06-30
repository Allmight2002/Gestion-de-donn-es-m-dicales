// Tracage des LECTURES SENSIBLES (cahier §7.1). Les ecritures sensibles sont tracees par des
// triggers ; les LECTURES (identite, document, image, export) le sont via des RPC SPECIALISEES
// (§5.5) : le client ne fournit QUE l'identifiant, le serveur derive l'entite/la base/l'autorisation
// (impossible de forger une fausse ligne). Best-effort : un echec de journalisation n'interrompt
// jamais la consultation.
//
// §5.6 : en PRODUCTION, la lecture d'un DOCUMENT ou d'une IMAGE passe par l'Edge signed-read, qui
// journalise deja avant de signer -> on n'ajoute pas un 2e audit cote client pour ces deux-la.
// La lecture d'IDENTITE ne passe pas par l'Edge -> toujours journalisee cote client.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const USE_SIGNED_READ = import.meta.env.VITE_USE_SIGNED_READ === 'true';

export interface AuditRepository {
  /** Consultation de l'identite d'un patient (fiche). Toujours journalisee (pas d'Edge). */
  logIdentityRead(patientId: string): Promise<void>;
  /** Ouverture d'un document du pool. En prod, l'Edge journalise -> no-op cote client (§5.6). */
  logRawDocumentRead(documentId: string): Promise<void>;
  /** Ouverture d'une image clinique. En prod, l'Edge journalise -> no-op cote client (§5.6). */
  logAttachmentRead(attachmentId: string): Promise<void>;
  /** Telechargement d'un export. */
  logExportRead(exportId: string): Promise<void>;
}

export function makeAuditRepository(client: SupabaseClient | null): AuditRepository {
  const call = async (fn: string, args: Record<string, unknown>): Promise<void> => {
    if (!client) return;
    try {
      await client.rpc(fn, args);
    } catch {
      // Journalisation best-effort : on n'interrompt jamais la consultation.
    }
  };
  return {
    logIdentityRead: (patientId) => call('log_identity_read', { p_patient_id: patientId }),
    logRawDocumentRead: (documentId) =>
      USE_SIGNED_READ ? Promise.resolve() : call('log_raw_document_read', { p_document_id: documentId }),
    logAttachmentRead: (attachmentId) =>
      USE_SIGNED_READ ? Promise.resolve() : call('log_attachment_read', { p_attachment_id: attachmentId }),
    logExportRead: (exportId) => call('log_export_read', { p_export_id: exportId }),
  };
}

export const auditRepository: AuditRepository = makeAuditRepository(supabase);
