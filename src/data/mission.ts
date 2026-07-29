// Comptes de mission (docs/spec-comptes-mission.md) : un medecin confie la saisie d'UNE
// base a un etudiant / enqueteur de terrain, pour une duree bornee et revocable.
//
// Aucune regle de securite ne vit ici : la creation passe par l'Edge Function (seule
// detentrice du droit admin Auth), la prolongation et la revocation par des RPC qui
// re-verifient tout cote serveur. Ce module ne fait que porter la demande.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/** Duree maximale d'une mission (decision du 2026-07-29) ; la base l'applique aussi. */
export const MISSION_MAX_MONTHS = 24;

export type MissionStatus = 'pending' | 'active' | 'expired' | 'revoked';

export interface MissionAccount {
  accessId: string;
  userId: string;
  email: string;
  fullName: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  canViewIdentity: boolean;
  identityJustification: string | null;
  /** L'etudiant a suivi le lien et defini son mot de passe. */
  activated: boolean;
}

export interface CreateMissionInput {
  baseId: string;
  email: string;
  expiresAt: string;
  canViewIdentity: boolean;
  identityJustification: string | null;
}

export interface MissionRepository {
  list(baseId: string): Promise<MissionAccount[]>;
  create(input: CreateMissionInput): Promise<{ mailSent: boolean }>;
  resend(baseId: string, email: string): Promise<void>;
  extend(accessId: string, expiresAt: string): Promise<void>;
  revoke(accessId: string): Promise<void>;
}

/** Etat lisible d'une mission, calcule a l'affichage (la base reste seule juge). */
export function missionStatus(m: MissionAccount, now: Date = new Date()): MissionStatus {
  if (m.revokedAt) return 'revoked';
  if (Date.parse(m.expiresAt) <= now.getTime()) return 'expired';
  return m.activated ? 'active' : 'pending';
}

/** Jours restants avant l'echeance (negatif si depassee). */
export function daysUntil(iso: string, now: Date = new Date()): number {
  return Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000);
}

/** Borne haute proposee par l'interface, alignee sur la contrainte de la base. */
export function maxExpiryDate(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + MISSION_MAX_MONTHS);
  return d;
}

const NOT_CONFIGURED = 'Backend Supabase non configure';

type MissionRow = {
  access_id: string; user_id: string; email: string; full_name: string | null;
  expires_at: string; revoked_at: string | null; created_at: string;
  can_view_identity: boolean; identity_justification: string | null; activated: boolean;
};

export function makeMissionRepository(client: SupabaseClient | null): MissionRepository {
  if (!client) {
    const fail = async (): Promise<never> => {
      throw new Error(NOT_CONFIGURED);
    };
    return { list: fail, create: fail, resend: fail, extend: fail, revoke: fail };
  }

  async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await client!.functions.invoke('create-mission-account', { body });
    if (error) {
      // L'Edge Function repond un message court et generique ; on le remonte tel quel
      // plutot que l'erreur de transport, sans jamais exposer d'interne.
      const detail = (error as { context?: { body?: unknown } }).context?.body;
      const message = typeof detail === 'string' ? safeMessage(detail) : null;
      throw new Error(message ?? error.message);
    }
    return (data ?? {}) as Record<string, unknown>;
  }

  return {
    async list(baseId) {
      const { data, error } = await client.rpc('mission_accounts', { p_base_id: baseId });
      if (error) throw error;
      return ((data ?? []) as MissionRow[]).map((r) => ({
        accessId: r.access_id,
        userId: r.user_id,
        email: r.email,
        fullName: r.full_name || null,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        createdAt: r.created_at,
        canViewIdentity: r.can_view_identity,
        identityJustification: r.identity_justification,
        activated: r.activated,
      }));
    },

    async create(input) {
      const result = await invoke({
        action: 'create',
        baseId: input.baseId,
        email: input.email,
        expiresAt: input.expiresAt,
        canViewIdentity: input.canViewIdentity,
        identityJustification: input.identityJustification,
      });
      return { mailSent: result.mailSent === true };
    },

    async resend(baseId, email) {
      await invoke({ action: 'resend', baseId, email });
    },

    async extend(accessId, expiresAt) {
      const { error } = await client.rpc('extend_mission_access', {
        p_access_id: accessId,
        p_expires_at: expiresAt,
      });
      if (error) throw error;
    },

    async revoke(accessId) {
      const { error } = await client.rpc('revoke_base_access', { p_access_id: accessId });
      if (error) throw error;
    },
  };
}

/** Extrait le message d'erreur JSON de l'Edge Function, sans rien inventer. */
function safeMessage(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    return typeof parsed.error === 'string' && parsed.error.length <= 300 ? parsed.error : null;
  } catch {
    return null;
  }
}

export const missionRepository: MissionRepository = makeMissionRepository(supabase);
