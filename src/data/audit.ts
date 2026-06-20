// Tracage des LECTURES SENSIBLES (cahier §7.1). Les ecritures sensibles sont deja tracees
// par des triggers (audit_log) ; les LECTURES (consultation d'identite, ouverture d'un
// document brut, etc.) ne peuvent pas l'etre par trigger en SQL. On appelle donc une RPC
// dediee au moment ou l'UI revele la donnee. C'est best-effort : un echec de journalisation
// ne doit JAMAIS interrompre la consultation.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type SensitiveAction = 'identity_read' | 'raw_document_read' | 'attachment_read' | 'export_read';

export interface AuditRepository {
  logSensitiveRead(action: SensitiveAction, entity: string, entityId: string, baseId: string): Promise<void>;
}

export function makeAuditRepository(client: SupabaseClient | null): AuditRepository {
  if (!client) {
    return { async logSensitiveRead() {} };
  }
  return {
    async logSensitiveRead(action, entity, entityId, baseId) {
      try {
        await client.rpc('log_sensitive_read', { p_action: action, p_entity: entity, p_entity_id: entityId, p_base_id: baseId });
      } catch {
        // Journalisation best-effort : on n'interrompt jamais la consultation.
      }
    },
  };
}

export const auditRepository: AuditRepository = makeAuditRepository(supabase);
