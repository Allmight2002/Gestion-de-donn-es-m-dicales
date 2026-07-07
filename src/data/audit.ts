// Tracage des LECTURES SENSIBLES (cahier §7.1). Les ecritures sensibles sont tracees par des
// triggers ; les LECTURES (identite, document, image, export) le sont via des RPC SPECIALISEES
// (§5.5) : le client ne fournit QUE l'identifiant, le serveur derive l'entite/la base/l'autorisation
// (impossible de forger une fausse ligne). Les lectures d'identite applicatives passent par
// get_patient_identity(), qui audite avant de renvoyer les champs ; logIdentityRead reste
// disponible pour les chemins historiques sans reveler de donnee.
//
// §5.6/§7.9 : en PRODUCTION, la lecture d'un DOCUMENT, d'une IMAGE ou d'un EXPORT conserve passe
// par l'Edge signed-read, qui journalise deja avant de signer -> on n'ajoute pas un 2e audit cote
// client pour ces trois-la (le client ne journalise qu'en LOCAL/demo, ou l'Edge n'existe pas).
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
  /** Telechargement d'un export conserve. En prod, l'Edge journalise -> no-op cote client (§7.9). */
  logExportRead(exportId: string): Promise<void>;
  /** C3 : journal d'activite LISIBLE d'une base (collaborateurs medecins). Lectures sensibles exclues. */
  getBaseActivity(baseId: string, options?: ActivityQueryOptions): Promise<ActivityEvent[]>;
}

export interface ActivityQueryOptions {
  before?: string | null;
  beforeId?: string | null;
  limit?: number;
  action?: string | null;
}

/** Un evenement du journal d'activite d'une base (C3). */
export interface ActivityEvent {
  id: string;
  at: string;
  action: string;
  actorName: string;
  metadata: Record<string, unknown> | null;
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
    logExportRead: (exportId) =>
      USE_SIGNED_READ ? Promise.resolve() : call('log_export_read', { p_export_id: exportId }),
    async getBaseActivity(baseId, options) {
      if (!client) return [];
      const { data, error } = await client.rpc('base_activity_log', {
        p_base_id: baseId,
        p_before: options?.before ?? null,
        p_before_id: options?.beforeId ?? null,
        p_limit: options?.limit ?? 50,
        p_action_filter: options?.action ?? null,
      });
      if (error) throw error;
      return (data ?? []) as ActivityEvent[];
    },
  };
}

export const auditRepository: AuditRepository = makeAuditRepository(supabase);
