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

/** Publication active du referentiel : sert a savoir si la copie locale est a jour. */
export interface TerminologyRelease {
  id: string;
  slug: string;
  version: string;
  conceptCount: number;
}

/** Concept tel que stocke localement. `searchText` vient du SERVEUR, deja normalise. */
export interface TerminologyEntry {
  code: string;
  label: string;
  searchText: string;
}

export interface TerminologyPage {
  entries: TerminologyEntry[];
  total: number;
}

export interface TerminologyRepository {
  /** Recherche incrementale ; renvoie une liste vide en deca de deux caracteres. */
  search(query: string, limit?: number): Promise<TerminologyOption[]>;
  /** Publication actuellement active, ou null si aucune. */
  activeRelease(): Promise<TerminologyRelease | null>;
  /** Page de concepts proposables d'une publication precise, pour constituer la copie locale. */
  listEntries(releaseId: string, offset: number, limit: number): Promise<TerminologyPage>;
}

/** Le serveur exige deux caracteres : inutile de l'appeler avant. */
export const MIN_QUERY_LENGTH = 2;

export function makeTerminologyRepository(client: SupabaseClient | null): TerminologyRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { search: fail, activeRelease: fail, listEntries: fail };
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

    async activeRelease() {
      const { data, error } = await client
        .from('terminology_release')
        .select('id, slug, version, concept_count')
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id as string,
        slug: data.slug as string,
        version: data.version as string,
        conceptCount: (data.concept_count as number) ?? 0,
      };
    },

    async listEntries(releaseId, offset, limit) {
      // Seuls les concepts proposables sont copies : les regroupements ne peuvent pas
      // etre choisis, les embarquer alourdirait la copie sans rien apporter.
      const { data, error, count } = await client
        .from('terminology_concept')
        .select('code, label, search_text', { count: 'exact' })
        .eq('release_id', releaseId)
        .eq('is_selectable', true)
        .not('code', 'is', null)
        .order('code', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      if (count === null) throw new Error('Comptage du référentiel indisponible.');
      return {
        entries: (data ?? []).map((r) => ({
          code: r.code as string,
          label: r.label as string,
          searchText: (r.search_text as string) ?? '',
        })),
        total: count,
      };
    },
  };
}

export const terminologyRepository: TerminologyRepository = makeTerminologyRepository(supabase);
