// Couche d'acces « groupes de recherche » (feature C2 v1 — etiquette d'organisation).
// Un groupe regroupe plusieurs bases d'un meme medecin. 1re version PUREMENT organisationnelle :
// aucun lien avec l'octroi d'acces (qui reste per-base, via les RPC auditees). Tables privees au
// proprietaire (RLS), donc ecritures directes RLS-gated (pas de donnee sensible).
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface ResearchGroup {
  id: string;
  name: string;
  createdAt: string;
  baseCount: number;
}
export interface GroupBase {
  id: string;
  name: string;
  specialty: string | null;
}

export interface GroupRepository {
  listGroups(): Promise<ResearchGroup[]>;
  createGroup(name: string): Promise<{ id: string }>;
  renameGroup(id: string, name: string): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  getGroupBases(groupId: string): Promise<GroupBase[]>;
  attachBase(groupId: string, baseId: string): Promise<void>;
  detachBase(baseId: string): Promise<void>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

type GroupRow = { id: string; name: string; created_at: string; research_group_base: { count: number }[] | null };
type LinkRow = { base: { id: string; name: string; specialty: string | null } | null };

export function makeGroupRepository(client: SupabaseClient | null): GroupRepository {
  if (!client) {
    const fail = async (): Promise<never> => { throw new Error(NOT_CONFIGURED); };
    return { listGroups: fail, createGroup: fail, renameGroup: fail, deleteGroup: fail, getGroupBases: fail, attachBase: fail, detachBase: fail };
  }

  return {
    async listGroups() {
      const { data, error } = await client
        .from('research_group')
        .select('id, name, created_at, research_group_base(count)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown as GroupRow[]).map((r) => ({
        id: r.id, name: r.name, createdAt: r.created_at, baseCount: r.research_group_base?.[0]?.count ?? 0,
      }));
    },

    async createGroup(name) {
      const { data: u } = await client.auth.getUser();
      const { data, error } = await client
        .from('research_group')
        .insert({ name, owner_user_id: u.user?.id ?? null })
        .select('id')
        .single();
      if (error) throw error;
      return { id: (data as { id: string }).id };
    },

    async renameGroup(id, name) {
      const { error } = await client.from('research_group').update({ name }).eq('id', id);
      if (error) throw error;
    },

    async deleteGroup(id) {
      const { error } = await client.from('research_group').delete().eq('id', id);
      if (error) throw error;
    },

    async getGroupBases(groupId) {
      const { data, error } = await client
        .from('research_group_base')
        .select('base:base_id(id, name, specialty)')
        .eq('group_id', groupId);
      if (error) throw error;
      return ((data ?? []) as unknown as LinkRow[])
        .map((r) => r.base)
        .filter((b): b is NonNullable<LinkRow['base']> => b !== null)
        .map((b) => ({ id: b.id, name: b.name, specialty: b.specialty }));
    },

    async attachBase(groupId, baseId) {
      const { error } = await client.from('research_group_base').insert({ group_id: groupId, base_id: baseId });
      if (error) throw error;
    },

    async detachBase(baseId) {
      const { error } = await client.from('research_group_base').delete().eq('base_id', baseId);
      if (error) throw error;
    },
  };
}

export const groupRepository: GroupRepository = makeGroupRepository(supabase);
