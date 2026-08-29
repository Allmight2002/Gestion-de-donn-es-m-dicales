// Couche d'acces aux cohortes (cahier §9.1, §8.9).
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type FilterScope = 'patient' | 'encounter';
export type FilterOp =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'between'
  // L21/L23 — variables MULTIVALUEES. La valeur du critere est un tableau de CODES, et
  // `jsonb_matches` cherche ces codes dans la liste enregistree. Une egalite sur une liste
  // ne compare rien d'utile : ces deux operateurs sont les seuls offerts dans ce cas.
  | 'has_any' | 'has_none';

export interface FilterCondition {
  scope: FilterScope;
  field: string;
  op: FilterOp;
  value: unknown;
  value2?: unknown;
}
export interface FilterDefinition {
  conditions: FilterCondition[];
}

export interface CohortSummary {
  id: string;
  name: string;
  cohortType: 'dynamic' | 'snapshot';
  snapshotAt: string | null;
  memberCount: number;
  filterDefinition: FilterDefinition;
  validatedOnly: boolean;
}

export interface CohortRepository {
  listCohorts(baseId: string): Promise<CohortSummary[]>;
  preview(baseId: string, filter: FilterDefinition, validatedOnly?: boolean): Promise<{ patientCount: number; encounterCount: number }>;
  createDynamic(baseId: string, name: string, filter: FilterDefinition, validatedOnly?: boolean): Promise<{ id: string }>;
  createSnapshot(baseId: string, name: string, filter: FilterDefinition, validatedOnly?: boolean): Promise<{ id: string }>;
  deleteCohort(cohortId: string): Promise<void>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makeCohortRepository(client: SupabaseClient | null): CohortRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { listCohorts: fail, preview: fail, createDynamic: fail, createSnapshot: fail, deleteCohort: fail };
  }

  return {
    async listCohorts(baseId) {
      const { data, error } = await client
        .from('cohort')
        .select('id, name, cohort_type, snapshot_at, filter_definition, validated_only, cohort_member(count)')
        .eq('base_id', baseId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        cohortType: c.cohort_type as 'dynamic' | 'snapshot',
        snapshotAt: (c.snapshot_at as string | null) ?? null,
        memberCount: ((c.cohort_member as { count: number }[] | null)?.[0]?.count) ?? 0,
        filterDefinition: (c.filter_definition as FilterDefinition) ?? { conditions: [] },
        validatedOnly: (c.validated_only as boolean | null) ?? true,
      }));
    },

    async preview(baseId, filter, validatedOnly = true) {
      const { data, error } = await client.rpc('cohort_preview', {
        p_base_id: baseId, p_filter: filter, p_validated_only: validatedOnly,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { patient_count: number; encounter_count: number } | undefined;
      return { patientCount: row?.patient_count ?? 0, encounterCount: row?.encounter_count ?? 0 };
    },

    async createDynamic(baseId, name, filter, validatedOnly = true) {
      const { data, error } = await client
        .from('cohort')
        .insert({ base_id: baseId, name, filter_definition: filter, cohort_type: 'dynamic', validated_only: validatedOnly })
        .select('id')
        .single();
      if (error) throw error;
      return { id: (data as { id: string }).id };
    },

    async createSnapshot(baseId, name, filter, validatedOnly = true) {
      const { data, error } = await client.rpc('create_cohort_snapshot', {
        p_base_id: baseId, p_name: name, p_filter: filter, p_validated_only: validatedOnly,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { id: string };
      return { id: row.id };
    },

    async deleteCohort(cohortId) {
      const { error } = await client.rpc('delete_cohort', { p_cohort_id: cohortId });
      if (error) throw error;
    },
  };
}

export const cohortRepository: CohortRepository = makeCohortRepository(supabase);
