import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export const ERROR_CONTEXTS = ['react-render', 'unhandled-rejection', 'window-error', 'data-save', 'import', 'upload', 'export', 'auth'] as const;
export type ErrorContext = (typeof ERROR_CONTEXTS)[number];

export interface ClientErrorLogEntry {
  id: string;
  occurred_at: string;
  last_occurred_at: string;
  received_at: string;
  error_name: string;
  error_message: string;
  stack: string | null;
  component_stack: string | null;
  context: ErrorContext;
  app_version: string | null;
  severity: 'error' | 'fatal';
  fingerprint: string;
  occurrence_count: number;
}

export interface ClientErrorRepository {
  listRecent(options?: { since?: string; context?: ErrorContext | null }): Promise<ClientErrorLogEntry[]>;
}

export function makeClientErrorRepository(client: SupabaseClient | null): ClientErrorRepository {
  return {
    async listRecent(options) {
      if (!client) throw new Error('Backend Supabase non configure');
      const { data, error } = await client.rpc('list_recent_client_errors', {
        p_limit: 100,
        p_since: options?.since ?? null,
        p_context: options?.context ?? null,
      });
      if (error) throw error;
      return (data ?? []) as ClientErrorLogEntry[];
    },
  };
}

export const clientErrorRepository = makeClientErrorRepository(supabase);
