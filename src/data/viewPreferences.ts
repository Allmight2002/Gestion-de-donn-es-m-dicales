// Préférences de présentation non cliniques, persistées côté serveur.
// Une ligne est propre à (utilisateur, base) et ne contient que des clés de champs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface ViewPreferenceRepository {
  /** Renvoie null quand l'utilisateur n'a encore jamais enregistré de choix. */
  getVisiblePatientFieldKeys(baseId: string): Promise<string[] | null>;
  /** Un tableau vide est un choix explicite : aucune colonne analytique supplémentaire. */
  saveVisiblePatientFieldKeys(baseId: string, fieldKeys: string[]): Promise<void>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

function normalizeFieldKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key): key is string => typeof key === 'string' && key.length > 0))];
}

export function makeViewPreferenceRepository(client: SupabaseClient | null): ViewPreferenceRepository {
  if (!client) {
    return {
      // Les écrans injectés et les environnements sans backend gardent leur défaut local.
      async getVisiblePatientFieldKeys() { return null; },
      async saveVisiblePatientFieldKeys() { /* aucun serveur disponible */ },
    };
  }

  async function currentUserId(): Promise<string> {
    // La session locale fournit uniquement l'identifiant utilisé comme clé RLS. La RLS
    // reste l'autorité : ce contrôle évite seulement une requête avec un user_id absent.
    const { data, error } = await client!.auth.getSession();
    if (error) throw error;
    const id = data.session?.user?.id;
    if (!id) throw new Error(NOT_CONFIGURED);
    return id;
  }

  return {
    async getVisiblePatientFieldKeys(baseId) {
      const userId = await currentUserId();
      const { data, error } = await client
        .from('base_view_preference')
        .select('visible_patient_field_keys')
        .eq('base_id', baseId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return normalizeFieldKeys((data as { visible_patient_field_keys?: unknown }).visible_patient_field_keys);
    },

    async saveVisiblePatientFieldKeys(baseId, fieldKeys) {
      const userId = await currentUserId();
      const { error } = await client
        .from('base_view_preference')
        .upsert({
          base_id: baseId,
          user_id: userId,
          visible_patient_field_keys: normalizeFieldKeys(fieldKeys),
        }, { onConflict: 'base_id,user_id' });
      if (error) throw error;
    },
  };
}

export const viewPreferenceRepository = makeViewPreferenceRepository(supabase);
