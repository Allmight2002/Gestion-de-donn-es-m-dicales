import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export const MISSION_MAX_MONTHS = 24;

export type MissionStatus = 'pending' | 'active' | 'expired' | 'revoked';
export type CredentialStatus = 'provisioning' | 'active' | 'revoked' | 'legacy_disabled';

export interface MissionCredential {
  loginIdentifier: string;
  password: string;
}

export interface MissionAccount {
  accessId: string;
  baseId: string;
  baseName: string;
  userId: string;
  accountLabel: string;
  loginIdentifier: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  canViewIdentity: boolean;
  identityJustification: string | null;
  credentialStatus: CredentialStatus;
  credentialGeneration: number | null;
  lastRotatedAt: string | null;
}

export interface CreateMissionInput {
  operationId: string;
  baseId: string;
  accountLabel: string;
  loginIdentifier: string;
  expiresAt: string;
  canViewIdentity: boolean;
  identityJustification: string | null;
}

export interface MissionRepository {
  list(baseId?: string): Promise<MissionAccount[]>;
  create(input: CreateMissionInput): Promise<MissionCredential>;
  regenerate(accessId: string, operationId: string): Promise<MissionCredential>;
  reveal(accessId: string): Promise<MissionCredential>;
  extend(accessId: string, expiresAt: string): Promise<void>;
  revoke(accessId: string): Promise<void>;
}

export function missionStatus(m: MissionAccount, now: Date = new Date()): MissionStatus {
  if (m.revokedAt || m.credentialStatus === 'revoked') return 'revoked';
  if (Date.parse(m.expiresAt) <= now.getTime()) return 'expired';
  return m.credentialStatus === 'active' ? 'active' : 'pending';
}

export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000);
}

export function maxExpiryDate(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + MISSION_MAX_MONTHS);
  return d;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

type MissionRow = {
  access_id: string;
  base_id: string;
  base_name: string;
  user_id: string;
  account_label: string;
  login_identifier: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  can_view_identity: boolean;
  identity_justification: string | null;
  credential_status: CredentialStatus;
  credential_generation: number | null;
  last_rotated_at: string | null;
};

function credentialFrom(result: Record<string, unknown>): MissionCredential {
  const raw = result.credential;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Justificatifs absents de la reponse');
  const credential = raw as Record<string, unknown>;
  if (typeof credential.loginIdentifier !== 'string' || typeof credential.password !== 'string') {
    throw new Error('Justificatifs invalides');
  }
  return { loginIdentifier: credential.loginIdentifier, password: credential.password };
}

export function makeMissionRepository(client: SupabaseClient | null): MissionRepository {
  if (!client) {
    const fail = async (): Promise<never> => { throw new Error(NOT_CONFIGURED); };
    return { list: fail, create: fail, regenerate: fail, reveal: fail, extend: fail, revoke: fail };
  }
  const configuredClient = client;

  async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await configuredClient.functions.invoke('create-mission-account', { body });
    if (error) {
      const detail = (error as { context?: { body?: unknown } }).context?.body;
      const message = typeof detail === 'string'
        ? safeMessage(detail)
        : detail && typeof detail === 'object' && typeof (detail as { error?: unknown }).error === 'string'
          ? String((detail as { error: string }).error)
          : null;
      throw new Error(message ?? error.message);
    }
    return (data ?? {}) as Record<string, unknown>;
  }

  return {
    async list(baseId) {
      const { data, error } = await configuredClient.rpc('mission_accounts_owned', { p_base_id: baseId ?? null });
      if (error) throw error;
      return ((data ?? []) as MissionRow[]).map((r) => ({
        accessId: r.access_id,
        baseId: r.base_id,
        baseName: r.base_name,
        userId: r.user_id,
        accountLabel: r.account_label,
        loginIdentifier: r.login_identifier,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        createdAt: r.created_at,
        canViewIdentity: r.can_view_identity,
        identityJustification: r.identity_justification,
        credentialStatus: r.credential_status,
        credentialGeneration: r.credential_generation,
        lastRotatedAt: r.last_rotated_at,
      }));
    },

    async create(input) {
      return credentialFrom(await invoke({ action: 'create', ...input }));
    },

    async regenerate(accessId, operationId) {
      return credentialFrom(await invoke({ action: 'regenerate', accessId, operationId }));
    },

    async reveal(accessId) {
      return credentialFrom(await invoke({ action: 'reveal', accessId }));
    },

    async extend(accessId, expiresAt) {
      const { error } = await client.rpc('extend_mission_access', {
        p_access_id: accessId,
        p_expires_at: expiresAt,
      });
      if (error) throw error;
    },

    async revoke(accessId) {
      await invoke({ action: 'revoke', accessId });
    },
  };
}

function safeMessage(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    return typeof parsed.error === 'string' && parsed.error.length <= 300 ? parsed.error : null;
  } catch {
    return null;
  }
}

export const missionRepository: MissionRepository = makeMissionRepository(supabase);
