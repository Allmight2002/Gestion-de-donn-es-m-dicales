// Couche d'acces aux cohortes (cahier §9.1, §8.9).
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type FilterScope = 'patient' | 'encounter';
export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'between';

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
}

export interface CohortRepository {
  listCohorts(baseId: string): Promise<CohortSummary[]>;
  preview(baseId: string, filter: FilterDefinition, validatedOnly?: boolean): Promise<{ patientCount: number; encounterCount: number }>;
  createDynamic(baseId: string, name: string, filter: FilterDefinition, validatedOnly?: boolean): Promise<{ id: string }>;
  createSnapshot(baseId: string, name: string, filter: FilterDefinition, validatedOnly?: boolean): Promise<{ id: string }>;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

export function makeCohortRepository(client: SupabaseClient | null): CohortRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { listCohorts: fail, preview: fail, createDynamic: fail, createSnapshot: fail };
  }

  return {
    async listCohorts(baseId) {
      const { data, error } = await client
        .from('cohort')
        .select('id, name, cohort_type, snapshot_at, cohort_member(count)')
        .eq('base_id', baseId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        cohortType: c.cohort_type as 'dynamic' | 'snapshot',
        snapshotAt: (c.snapshot_at as string | null) ?? null,
        memberCount: ((c.cohort_member as { count: number }[] | null)?.[0]?.count) ?? 0,
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
  };
}

export const cohortRepository: CohortRepository = makeCohortRepository(supabase);
