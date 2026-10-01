// Formulaires de saisie d'une base : configuration partagee entre les membres, sans aucune
// donnee patient. Un formulaire n'est qu'une liste ordonnee de cles de variables de fiche ;
// toutes les saisies alimentent le meme enregistrement par les RPC cliniques habituelles.
// La RLS reserve l'ecriture au proprietaire de la base (migration 20261001100000).
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface EntryForm {
  id: string;
  baseId: string;
  name: string;
  /** Variables du formulaire, dans l'ordre de saisie voulu par le responsable. */
  fieldKeys: string[];
  /** Variables indispensables a l'enregistrement depuis CE formulaire (sous-ensemble). */
  requiredKeys: string[];
  /** Verrou optimiste : incremente par la base a chaque modification. */
  rowVersion: number;
  updatedAt: string;
}

export interface EntryFormInput {
  name: string;
  fieldKeys: string[];
  requiredKeys: string[];
}

/** Le formulaire a ete modifie ou supprime par ailleurs : rien n'a ete ecrit. */
export class EntryFormConflictError extends Error {
  readonly code = 'ENTRY_FORM_CONFLICT';
  constructor() {
    super('Ce formulaire a été modifié ou supprimé entre-temps. Vos réglages sont conservés : rechargez avant de recommencer.');
    this.name = 'EntryFormConflictError';
  }
}

export interface EntryFormRepository {
  list(baseId: string): Promise<EntryForm[]>;
  create(baseId: string, input: EntryFormInput): Promise<EntryForm>;
  /** Echoue avec `EntryFormConflictError` si `expectedVersion` n'est plus la version courante. */
  update(id: string, expectedVersion: number, input: EntryFormInput): Promise<EntryForm>;
  remove(id: string, expectedVersion: number): Promise<void>;
}

const COLUMNS = 'id, base_id, name, field_keys, required_keys, row_version, updated_at';

function keysOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((key): key is string => typeof key === 'string' && key.length > 0))];
}

export function toEntryForm(row: Record<string, unknown>): EntryForm {
  const fieldKeys = keysOf(row.field_keys);
  return {
    id: String(row.id),
    baseId: String(row.base_id),
    name: String(row.name ?? ''),
    fieldKeys,
    requiredKeys: keysOf(row.required_keys).filter((key) => fieldKeys.includes(key)),
    rowVersion: Number(row.row_version ?? 0),
    updatedAt: String(row.updated_at ?? ''),
  };
}

/** Forme envoyee au serveur : nom borde, cles uniques, requis inclus dans le formulaire. */
export function normalizeEntryFormInput(input: EntryFormInput): EntryFormInput {
  const fieldKeys = keysOf(input.fieldKeys);
  return {
    name: input.name.trim(),
    fieldKeys,
    requiredKeys: keysOf(input.requiredKeys).filter((key) => fieldKeys.includes(key)),
  };
}

export function makeEntryFormRepository(client: SupabaseClient | null): EntryFormRepository {
  if (!client) {
    return {
      // Sans backend, aucun formulaire court n'existe : seul le formulaire complet est offert.
      async list() { return []; },
      async create() { throw new Error('Backend Supabase non configure'); },
      async update() { throw new Error('Backend Supabase non configure'); },
      async remove() { throw new Error('Backend Supabase non configure'); },
    };
  }

  return {
    async list(baseId) {
      const { data, error } = await client
        .from('base_entry_form')
        .select(COLUMNS)
        .eq('base_id', baseId)
        .order('name', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(toEntryForm);
    },

    async create(baseId, input) {
      const body = normalizeEntryFormInput(input);
      const { data, error } = await client
        .from('base_entry_form')
        .insert({ base_id: baseId, name: body.name, field_keys: body.fieldKeys, required_keys: body.requiredKeys })
        .select(COLUMNS)
        .single();
      if (error) throw error;
      return toEntryForm(data as Record<string, unknown>);
    },

    async update(id, expectedVersion, input) {
      const body = normalizeEntryFormInput(input);
      const { data, error } = await client
        .from('base_entry_form')
        .update({ name: body.name, field_keys: body.fieldKeys, required_keys: body.requiredKeys })
        .eq('id', id)
        .eq('row_version', expectedVersion)
        .select(COLUMNS);
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length !== 1) throw new EntryFormConflictError();
      return toEntryForm(rows[0]);
    },

    async remove(id, expectedVersion) {
      const { data, error } = await client
        .from('base_entry_form')
        .delete()
        .eq('id', id)
        .eq('row_version', expectedVersion)
        .select('id');
      if (error) throw error;
      if ((data ?? []).length !== 1) throw new EntryFormConflictError();
    },
  };
}

export const entryFormRepository = makeEntryFormRepository(supabase);
