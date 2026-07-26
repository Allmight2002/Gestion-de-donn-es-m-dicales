// Couche d'acces au referentiel de terminologie (feature T3).
//
// La recherche est deleguee au serveur : le referentiel compte des dizaines de milliers de
// concepts, on ne le charge pas dans le navigateur pour l'instant. La RPC borne d'elle-meme
// le nombre de resultats et exige deux caracteres.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const NOT_CONFIGURED = 'Supabase non configure';

/** Concept propose a la saisie. `code` est l'identifiant stable, `label` ce qu'on affiche. */
export interface TerminologyOption {
  id: string;
  code: string;
  label: string;
  kind: string;
  depth: number;
}

export interface TerminologyRepository {
  /** Recherche incrementale ; renvoie une liste vide en deca de deux caracteres. */
  search(query: string, limit?: number): Promise<TerminologyOption[]>;
}

/** Le serveur exige deux caracteres : inutile de l'appeler avant. */
export const MIN_QUERY_LENGTH = 2;

export function makeTerminologyRepository(client: SupabaseClient | null): TerminologyRepository {
  if (!client) {
    return {
      async search() {
        throw new Error(NOT_CONFIGURED);
      },
    };
  }

  return {
    async search(query, limit = 20) {
      if (query.trim().length < MIN_QUERY_LENGTH) return [];
      const { data, error } = await client.rpc('search_terminology', {
        p_query: query.trim(),
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as TerminologyOption[];
    },
  };
}

export const terminologyRepository: TerminologyRepository = makeTerminologyRepository(supabase);
