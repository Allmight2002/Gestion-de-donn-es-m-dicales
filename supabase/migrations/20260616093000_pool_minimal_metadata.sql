-- =============================================================================
-- 20260616093000_pool_minimal_metadata.sql  (audit 3 §10)
-- Avant reservation, un curateur pouvait SELECT les lignes COMPLETES de curation_task et
-- raw_submission, donc lire bien plus que ce que l'UI montre : base_id, id technique du
-- patient cible, external_ref, notes, version de gabarit, statut complet, soumissionnaire.
-- Correctif :
--   - rs_select / ct_select : acces COMPLET reserve au PROPRIETAIRE ou au curateur AFFECTE
--     (apres reservation). Un curateur non affecte ne lit plus ces lignes directement.
--   - curation_pool() : RPC MINIMALE (SECURITY DEFINER) pour lister le pool avant reservation
--     -> uniquement task_id, statut, code opaque, portee, specialite, date, nb de documents,
--        affectation. Aucune donnee sensible (ni base_id, ni patient, ni external_ref, ni notes).
-- Migration ADDITIVE.
-- =============================================================================

-- Acces direct COMPLET reserve au proprietaire / curateur affecte (apres reservation).
drop policy if exists rs_select on public.raw_submission;
create policy rs_select on public.raw_submission for select to authenticated
  using (public.is_base_owner(base_id) or public.is_assigned_to_submission(id));

drop policy if exists ct_select on public.curation_task;
create policy ct_select on public.curation_task for select to authenticated
  using (public.is_base_owner(base_id) or public.is_assigned_curator(id));

-- Pool MINIMAL pour le staff (avant reservation) : aucune metadonnee sensible.
create or replace function public.curation_pool()
returns table (
  task_id uuid, status text, case_code text, scope text,
  specialty text, submitted_at timestamptz, document_count int,
  assigned_to uuid, assigned_name text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.status, s.case_code, s.scope, b.specialty, s.created_at,
         (select count(*)::int from public.raw_document d where d.submission_id = s.id and d.deleted_at is null),
         t.assigned_to, pr.full_name
  from public.curation_task t
  join public.raw_submission s on s.id = t.submission_id
  join public.base b on b.id = t.base_id
  left join public.profiles pr on pr.id = t.assigned_to
  where public.is_curation_staff()
    and t.deleted_at is null
    and t.status <> 'preparing'
  order by s.created_at;
$$;
grant execute on function public.curation_pool() to authenticated;
