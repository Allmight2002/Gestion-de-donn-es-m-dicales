-- =============================================================================
-- 20260922193000_optional_reasons.sql
-- Le motif devient facultatif pour toutes les operations qui le demandaient :
-- corrections (patient, identite, rencontre, occurrence), suppressions logiques
-- (patient, rencontre, piece jointe) et mise en corbeille d'une base.
--
-- Rien n'est assoupli cote autorisation : chaque RPC verifie ses droits AVANT
-- d'appeler form_justification_status, qui ne fait plus que qualifier le motif.
-- L'auteur, la date et les valeurs restent journalises. Un motif absent est
-- trace 'not_provided' (hors proprietaire medecin, qui garde 'owner_exempt'),
-- pour ne pas confondre une dispense historique avec une simple omission.
-- La justification d'ouverture de l'identite a un compte de mission n'est pas
-- un motif d'operation et reste exigee.
--
-- Retour arriere : reappliquer les definitions de 20260916100000 et
-- 20260801140238. Les lignes 'not_provided' deja ecrites violeraient alors
-- l'ancienne contrainte : elle devrait etre recreee en NOT VALID.
-- =============================================================================

alter table public.field_change_log
  drop constraint if exists field_change_justification_status_check;
alter table public.field_change_log
  add constraint field_change_justification_status_check
  check (justification_status is null or justification_status in ('provided', 'owner_exempt', 'not_provided'));

create or replace function public.form_justification_status(p_base_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(p_reason), '') is not null then return 'provided'; end if;
  if public.is_base_owner(p_base_id) and public.is_medecin() then return 'owner_exempt'; end if;
  return 'not_provided';
end
$$;
revoke all on function public.form_justification_status(uuid, text) from public, anon, authenticated;

-- Seul changement : le motif vide est accepte (sa longueur reste bornee) et
-- l'audit n'enregistre plus de cle 'reason' nulle.
create or replace function public.soft_delete_base(p_base_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.base;
  v_reason text;
  v_now timestamptz := now();
  v_snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select * into b from public.base where id = p_base_id for update;
  if not found then raise exception 'Base introuvable'; end if;
  if b.owner_user_id <> auth.uid() then raise exception 'Reserve au proprietaire de la base'; end if;
  if b.deleted_at is not null then return; end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is not null and char_length(v_reason) > 500 then raise exception 'Motif de suppression trop long'; end if;

  select jsonb_build_object(
    'raw_submission_statuses', coalesce((
      select jsonb_object_agg(s.id::text, to_jsonb(s.status))
      from public.raw_submission s
      where s.base_id = p_base_id and s.deleted_at is null
    ), '{}'::jsonb),
    'curation_task_statuses', coalesce((
      select jsonb_object_agg(t.id::text, to_jsonb(t.status))
      from public.curation_task t
      where t.base_id = p_base_id and t.deleted_at is null and t.status <> 'completed'
    ), '{}'::jsonb)
  ) into v_snapshot;

  -- Etiquette d'organisation privee : la suppression conserve le comportement
  -- existant et detache la base du groupe, sans effet sur les droits d'acces.
  delete from public.research_group_base
   where base_id = p_base_id;

  update public.base_access
     set revoked_at = coalesce(revoked_at, v_now)
   where base_id = p_base_id and revoked_at is null;

  update public.base_invitation
     set status = 'revoked'
   where base_id = p_base_id and status = 'pending';

  update public.patient
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
   where base_id = p_base_id and deleted_at is null;
  update public.patient_identity
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
   where base_id = p_base_id and deleted_at is null;
  update public.encounter e
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
    from public.patient p
   where e.patient_id = p.id and p.base_id = p_base_id and e.deleted_at is null;
  update public.clinical_attachment a
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason
    from public.patient p
   where a.patient_id = p.id and p.base_id = p_base_id and a.deleted_at is null;

  update public.raw_submission
     set deleted_at = v_now, deleted_by = auth.uid(), deletion_reason = v_reason, status = 'cancelled'
   where base_id = p_base_id and deleted_at is null;
  update public.raw_document
     set deleted_at = v_now, deletion_reason = v_reason
   where base_id = p_base_id and deleted_at is null;
  update public.curation_task
     set deleted_at = v_now, status = 'cancelled', updated_at = v_now
   where base_id = p_base_id and deleted_at is null and status <> 'completed';

  update public.base
     set deleted_at = v_now,
         deleted_by = auth.uid(),
         deletion_reason = v_reason,
         deletion_snapshot = v_snapshot
   where id = p_base_id;

  perform public.log_audit('base_deleted', 'base', p_base_id, p_base_id, jsonb_strip_nulls(jsonb_build_object('reason', v_reason)));
end $$;
