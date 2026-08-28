// Handler testable de reconcile-quarantine (audit lot 9 §C3) : reconciliation operationnelle des
// mouvements de quarantaine incomplets (Storage <-> SQL), reservee aux system_admin. Effets externes
// (clients Supabase, horloge) injectes ; index.ts est l'adaptateur Deno.serve.
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseReconcileRequest, readJsonObject, validationResponse } from '../_shared/contracts.ts';

export interface ReconcileDeps {
  buildClients: (authHeader: string) => { asUser: SupabaseClient; admin: SupabaseClient };
  nowIso: () => string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export async function handleReconcileQuarantine(req: Request, deps: ReconcileDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST requis' });

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Authentification requise' });

  let asUser: SupabaseClient;
  let admin: SupabaseClient;
  try {
    ({ asUser, admin } = deps.buildClients(auth));
  } catch {
    return json(500, { error: 'Configuration serveur indisponible' });
  }

  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return json(401, { error: 'Session invalide' });
  const { data: profile } = await admin.from('profiles').select('global_role').eq('id', who.user.id).maybeSingle();
  if (profile?.global_role !== 'system_admin') return json(403, { error: 'Reserve a l administrateur systeme' });

  let limit: number;
  try {
    ({ limit } = parseReconcileRequest(await readJsonObject(req)));
  } catch (error) {
    return validationResponse(error);
  }

  const { data: candidates, error } = await admin.rpc('quarantine_reconciliation_candidates', { p_limit: limit });
  if (error) return json(500, { error: 'Lecture des reconciliations impossible' });

  const results: Array<{ id: string; status: string; detail?: string }> = [];

  for (const move of candidates ?? []) {
    const updateMove = async (status: string, detail: string | null = null) => {
      await admin.rpc('update_quarantine_move', {
        p_move_id: move.id,
        p_status: status,
        p_last_error: detail,
      });
    };

    try {
      if (move.status === 'started') {
        await updateMove('reconcile_failed', 'copie quarantaine non confirmee');
        results.push({ id: move.id, status: 'reconcile_failed', detail: 'copie quarantaine non confirmee' });
        continue;
      }

      const { data: row, error: rowErr } = await admin
        .from(move.entity)
        .select('inspection_status, inspection_run_id, quarantine_path')
        .eq('id', move.entity_id)
        .maybeSingle();
      if (rowErr || !row) {
        await updateMove('reconcile_failed', 'ligne documentaire introuvable');
        results.push({ id: move.id, status: 'reconcile_failed', detail: 'ligne documentaire introuvable' });
        continue;
      }

      if (row.inspection_status === 'quarantined' && row.quarantine_path === move.quarantine_path) {
        await updateMove('finalized');
        results.push({ id: move.id, status: 'finalized', detail: 'deja finalise' });
        continue;
      }

      if (row.inspection_status !== 'scanning' || row.inspection_run_id !== move.run_id) {
        await updateMove('reconcile_failed', `statut non reconciliable: ${row.inspection_status}`);
        results.push({
          id: move.id,
          status: 'reconcile_failed',
          detail: `statut non reconciliable: ${row.inspection_status}`,
        });
        continue;
      }

      if (move.status === 'copied') {
        const { error: removeErr } = await admin.storage.from(move.source_bucket).remove([move.source_path]);
        if (removeErr) {
          await updateMove('reconcile_failed', `suppression original impossible: ${removeErr.message}`);
          results.push({ id: move.id, status: 'reconcile_failed', detail: removeErr.message });
          continue;
        }
        await updateMove('original_deleted');
      }

      const { data: ok, error: rpcErr } = await admin.rpc('complete_file_inspection', {
        p_entity: move.entity,
        p_id: move.entity_id,
        p_run_id: move.run_id,
        p_user_id: move.inspected_by,
        p_status: 'quarantined',
        p_inspected_at: deps.nowIso(),
        p_file_hash: move.file_hash,
        p_file_size: move.file_size,
        p_detected_mime_type: move.detected_mime_type,
        p_mime_type: move.mime_type,
        p_engine: move.engine,
        p_signature: move.signature,
        p_extra: move.extra ?? {},
        p_quarantine_bucket: move.quarantine_bucket,
        p_quarantine_path: move.quarantine_path,
      });
      if (rpcErr || ok !== true) {
        const detail = rpcErr?.message ?? 'run perime ou ligne non finalisee';
        await updateMove('reconcile_failed', detail);
        results.push({ id: move.id, status: 'reconcile_failed', detail });
        continue;
      }

      await updateMove('finalized');
      results.push({ id: move.id, status: 'finalized' });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await updateMove('reconcile_failed', detail).catch(() => undefined);
      results.push({ id: move.id, status: 'reconcile_failed', detail });
    }
  }

  return json(200, { processed: results.length, results });
}
